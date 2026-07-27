import { execFileSync } from "child_process";
import type { AsrGpuBackend, AsrGpuKind } from "../shared/asr";

export type AsrGpuInfo = {
  backend: AsrGpuBackend;
  /** Human-readable adapter name, or "CPU". */
  deviceLabel: string;
  kind: AsrGpuKind;
};

/** CrispASR Windows CUDA builds target Turing+ (sm_75 / compute 7.5). */
export const ASR_CUDA_MIN_COMPUTE = 7.5;

function tryExec(cmd: string, args: string[], timeoutMs = 2500): string | null {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function listWindowsAdapters(): string[] {
  const out = tryExec("powershell.exe", [
    "-NoProfile",
    "-Command",
    "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
  ]);
  if (!out) return [];
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((name) => !/microsoft\s*basic|remote\s*display|asklink|virtual|mirage|idd/i.test(name));
}

function classifyAdapter(name: string): AsrGpuKind {
  const n = name.toLowerCase();
  if (/nvidia|geforce|rtx|gtx|quadro|tesla/i.test(n)) return "discrete";
  if (/radeon\s*rx|radex|amd\s*r[ao]deon\s*\d|intel\s*arc/i.test(n)) return "discrete";
  // 780M / Iris / UHD / Vega iGPU
  if (/radeon\s*\d{3,4}m|graphics|iris|uhd|vega|intel\(r\)/i.test(n)) return "integrated";
  if (/amd|radeon|nvidia|intel/i.test(n)) return "integrated";
  return "integrated";
}

function pickBestAdapter(adapters: string[]): { name: string; kind: AsrGpuKind } | null {
  if (!adapters.length) return null;
  const ranked = adapters.map((name) => ({ name, kind: classifyAdapter(name) }));
  const discrete = ranked.find((a) => a.kind === "discrete");
  if (discrete) return discrete;
  return ranked[0] ?? null;
}

function hasNvidiaSmi(): boolean {
  const out = tryExec("nvidia-smi", ["-L"]);
  return Boolean(out && /GPU\s+\d+/i.test(out));
}

/** Parse `nvidia-smi --query-gpu=compute_cap --format=csv,noheader` output. */
export function parseNvidiaComputeCaps(csv: string): number[] {
  const caps: number[] = [];
  for (const line of csv.split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+(?:\.\d+)?)/);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n)) caps.push(n);
  }
  return caps;
}

function queryNvidiaComputeCaps(): number[] {
  const out = tryExec("nvidia-smi", [
    "--query-gpu=compute_cap",
    "--format=csv,noheader",
  ]);
  return out ? parseNvidiaComputeCaps(out) : [];
}

/**
 * True when at least one GPU can run the CrispASR Windows/Linux CUDA package
 * (Turing+ / compute ≥ 7.5). Empty caps → unknown; caller may still try CUDA.
 */
export function nvidiaSupportsBundledCuda(caps: number[]): boolean {
  if (!caps.length) return true;
  return caps.some((c) => c >= ASR_CUDA_MIN_COMPUTE);
}

/**
 * Windows NTSTATUS-style exit codes from a crashed native child
 * (access violation, missing DLL, bad image, DLL init failure).
 */
export function isAsrNativeCrashExitCode(code: number | null | undefined): boolean {
  if (code == null || !Number.isFinite(code)) return false;
  const unsigned = code < 0 ? code + 0x1_0000_0000 : code;
  return (
    unsigned === 0xc0000005 || // STATUS_ACCESS_VIOLATION
    unsigned === 0xc0000135 || // STATUS_DLL_NOT_FOUND
    unsigned === 0xc000007b || // STATUS_INVALID_IMAGE_FORMAT
    unsigned === 0xc0000142 // STATUS_DLL_INIT_FAILED
  );
}

/** Extract exit code from `ASR exited with code N` / stream messages. */
export function parseAsrExitCode(message: string): number | null {
  const m = message.match(/exited with code\s+(-?\d+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function hasVulkanRuntime(): boolean {
  if (process.platform === "win32") {
    return Boolean(tryExec("where.exe", ["vulkaninfo"]) || tryExec("where.exe", ["vulkan-1.dll"]));
  }
  if (process.platform === "linux") {
    return Boolean(tryExec("vulkaninfo", ["--summary"]));
  }
  return false;
}

/**
 * Prefer discrete NVIDIA CUDA → Vulkan (AMD/Intel iGPU or dGPU) → CPU.
 * macOS CrispASR build uses Metal.
 *
 * NVIDIA notes: CrispASR Windows CUDA targets compute ≥ 7.5 (RTX 20+).
 * Older cards (GTX 10 / Pascal) get Vulkan instead of a hard crash.
 */
export function detectAsrGpuInfo(): AsrGpuInfo {
  if (process.platform === "darwin") {
    return {
      backend: "metal",
      deviceLabel: "Apple GPU (Metal)",
      kind: "metal",
    };
  }

  if (process.platform === "win32") {
    const adapters = listWindowsAdapters();
    const best = pickBestAdapter(adapters);
    const nvidiaName =
      adapters.find((n) => /nvidia|geforce|rtx|gtx|quadro|tesla/i.test(n)) ?? null;

    if (hasNvidiaSmi()) {
      const caps = queryNvidiaComputeCaps();
      const label = nvidiaName ?? best?.name ?? "NVIDIA GPU";
      if (nvidiaSupportsBundledCuda(caps)) {
        return { backend: "cuda", deviceLabel: label, kind: "discrete" };
      }
      // Pre-Turing NVIDIA: Vulkan still accelerates; CUDA binary would AV.
      return {
        backend: "vulkan",
        deviceLabel: `${label} · Vulkan`,
        kind: "discrete",
      };
    }

    if (best) {
      return {
        backend: "vulkan",
        deviceLabel: best.name,
        kind: best.kind,
      };
    }

    if (hasVulkanRuntime()) {
      return { backend: "vulkan", deviceLabel: "Vulkan GPU", kind: "integrated" };
    }

    return { backend: "cpu", deviceLabel: "CPU", kind: "cpu" };
  }

  if (process.platform === "linux") {
    if (hasNvidiaSmi()) {
      const caps = queryNvidiaComputeCaps();
      if (nvidiaSupportsBundledCuda(caps)) {
        return { backend: "cuda", deviceLabel: "NVIDIA GPU", kind: "discrete" };
      }
      return {
        backend: "vulkan",
        deviceLabel: "NVIDIA GPU · Vulkan",
        kind: "discrete",
      };
    }
    if (hasVulkanRuntime()) {
      return { backend: "vulkan", deviceLabel: "Vulkan GPU", kind: "integrated" };
    }
    return { backend: "cpu", deviceLabel: "CPU", kind: "cpu" };
  }

  return { backend: "cpu", deviceLabel: "CPU", kind: "cpu" };
}

/** @deprecated Prefer detectAsrGpuInfo().backend */
export function detectAsrGpuBackend(): AsrGpuBackend {
  return detectAsrGpuInfo().backend;
}

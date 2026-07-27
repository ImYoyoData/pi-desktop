import { existsSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import type { AsrGpuBackend, AsrGpuKind, AsrGpuOption } from "../shared/asr";

export type AsrGpuInfo = {
  backend: AsrGpuBackend;
  /** Human-readable adapter name, or "CPU". */
  deviceLabel: string;
  kind: AsrGpuKind;
  /**
   * Preferred Vulkan device index for CrispASR `-dev`.
   * Set when backend is vulkan and multiple GPUs exist.
   */
  vulkanDeviceId?: number;
};

export type VulkanDevice = {
  index: number;
  name: string;
  type: "integrated" | "discrete" | "other";
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

function isNvidiaName(name: string): boolean {
  return /nvidia|geforce|rtx|gtx|quadro|tesla/i.test(name);
}

function isAmdOrIntelName(name: string): boolean {
  return /amd|radeon|intel|iris|uhd|arc/i.test(name) && !isNvidiaName(name);
}

/** Locate nvidia-smi even when it is missing from PATH (common on consumer Windows). */
export function resolveNvidiaSmiPath(): string | null {
  const which = tryExec(process.platform === "win32" ? "where.exe" : "which", ["nvidia-smi"]);
  if (which) {
    const first = which
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean);
    if (first && existsSync(first)) return first;
  }
  if (process.platform === "win32") {
    const candidates = [
      join(process.env.SystemRoot || "C:\\Windows", "System32", "nvidia-smi.exe"),
      "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe",
      "C:\\Windows\\System32\\nvidia-smi.exe",
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
  }
  return null;
}

function hasNvidiaSmi(): boolean {
  const smi = resolveNvidiaSmiPath();
  if (!smi) return false;
  const out = tryExec(smi, ["-L"]);
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
  const smi = resolveNvidiaSmiPath();
  if (!smi) return [];
  const out = tryExec(smi, ["--query-gpu=compute_cap", "--format=csv,noheader"]);
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
 * Estimate compute capability from marketing names when nvidia-smi is unavailable.
 * Returns null when unknown.
 */
export function estimateNvidiaComputeFromName(name: string): number | null {
  const n = name.toLowerCase();
  if (!isNvidiaName(n)) return null;
  if (/rtx\s*50|blackwell/i.test(n)) return 10.0;
  if (/rtx\s*40|ada/i.test(n)) return 8.9;
  if (/rtx\s*30|ampere/i.test(n)) return 8.6;
  if (/rtx\s*20|gtx\s*16|turing|1660|1650|2060|2070|2080/i.test(n)) return 7.5;
  if (/gtx\s*10|pascal|1050|1060|1070|1080/i.test(n)) return 6.1;
  if (/gtx\s*9|maxwell|960|970|980/i.test(n)) return 5.2;
  return null;
}

/**
 * Parse `vulkaninfo --summary` (or full dump) into enumerated GPUs.
 */
export function parseVulkanInfoSummary(text: string): VulkanDevice[] {
  const devices: VulkanDevice[] = [];
  const blocks = text.split(/\bGPU(\d+)\s*:/i);
  // split yields [preamble, idx0, body0, idx1, body1, ...]
  for (let i = 1; i + 1 < blocks.length; i += 2) {
    const index = Number(blocks[i]);
    const body = blocks[i + 1] ?? "";
    if (!Number.isFinite(index)) continue;
    const nameMatch = body.match(/deviceName\s*=\s*(.+)/i);
    const typeMatch = body.match(/deviceType\s*=\s*PHYSICAL_DEVICE_TYPE_(\w+)/i);
    const name = (nameMatch?.[1] ?? "").trim();
    if (!name) continue;
    const typeRaw = (typeMatch?.[1] ?? "").toUpperCase();
    let type: VulkanDevice["type"] = "other";
    if (typeRaw.includes("INTEGRATED")) type = "integrated";
    else if (typeRaw.includes("DISCRETE")) type = "discrete";
    devices.push({ index, name, type });
  }
  return devices;
}

function listVulkanDevices(): VulkanDevice[] {
  if (process.platform === "darwin") return [];
  const cmd = process.platform === "win32" ? "vulkaninfo.exe" : "vulkaninfo";
  const out =
    tryExec(cmd, ["--summary"], 4000) ||
    tryExec(join(process.env.SystemRoot || "C:\\Windows", "System32", "vulkaninfo.exe"), [
      "--summary",
    ], 4000);
  return out ? parseVulkanInfoSummary(out) : [];
}

/**
 * Pick a Vulkan device for CrispASR (auto mode).
 * Prefer discrete GPUs (RTX/AMD dGPU) over integrated iGPUs.
 */
export function pickVulkanDeviceIndex(devices: VulkanDevice[]): number | undefined {
  if (!devices.length) return undefined;
  const score = (d: VulkanDevice): number => {
    let s = 0;
    if (d.type === "discrete") s += 200;
    if (isNvidiaName(d.name) && d.type === "discrete") s += 80; // RTX/GTX dGPU first
    if (isAmdOrIntelName(d.name) && d.type === "discrete") s += 60;
    if (isAmdOrIntelName(d.name) && d.type === "integrated") s += 20;
    if (isNvidiaName(d.name) && d.type !== "discrete") s += 10;
    return s;
  };
  const ranked = [...devices].sort((a, b) => score(b) - score(a) || a.index - b.index);
  return ranked[0]?.index;
}

/** Enumerate selectable ASR GPU targets for settings. */
export function enumerateAsrGpuOptions(): AsrGpuOption[] {
  const options: AsrGpuOption[] = [
    {
      id: "auto",
      label: "Auto",
      backend: "cpu",
      kind: "cpu",
    },
  ];

  if (process.platform === "darwin") {
    options.push({
      id: "metal",
      label: "Apple GPU (Metal)",
      backend: "metal",
      kind: "metal",
    });
    options.push({ id: "cpu", label: "CPU", backend: "cpu", kind: "cpu" });
    options[0] = { id: "auto", label: "Auto", backend: "metal", kind: "metal" };
    return options;
  }

  const vulkanDevices = listVulkanDevices();
  const adapters = process.platform === "win32" ? listWindowsAdapters() : [];
  const nvidia = nvidiaNamesFrom(adapters, vulkanDevices);
  const nvidiaLabel = nvidia[0] ?? null;
  if (nvidiaLabel || hasNvidiaSmi()) {
    const caps = queryNvidiaComputeCaps();
    const estimated = nvidiaLabel ? estimateNvidiaComputeFromName(nvidiaLabel) : null;
    const knownCaps = caps.length ? caps : estimated != null ? [estimated] : [];
    if (nvidiaSupportsBundledCuda(knownCaps)) {
      options.push({
        id: "cuda",
        label: `${nvidiaLabel ?? "NVIDIA GPU"} (CUDA)`,
        backend: "cuda",
        kind: "discrete",
      });
    }
  }

  for (const d of vulkanDevices) {
    const kind: AsrGpuKind = d.type === "discrete" ? "discrete" : "integrated";
    options.push({
      id: `vulkan:${d.index}`,
      label: `${d.name} (Vulkan)`,
      backend: "vulkan",
      kind,
      vulkanDeviceId: d.index,
    });
  }

  if (!vulkanDevices.length && hasVulkanRuntime()) {
    options.push({
      id: "vulkan:0",
      label: "Vulkan GPU",
      backend: "vulkan",
      kind: "integrated",
      vulkanDeviceId: 0,
    });
  }

  options.push({ id: "cpu", label: "CPU", backend: "cpu", kind: "cpu" });

  const auto = detectAsrGpuInfo();
  options[0] = {
    id: "auto",
    label: "Auto",
    backend: auto.backend,
    kind: auto.kind,
    vulkanDeviceId: auto.vulkanDeviceId,
  };
  return options;
}

/**
 * Resolve a user preference id into concrete GPU info.
 * Unknown / empty → auto detect.
 * macOS only supports Metal / CPU (never CUDA/Vulkan).
 */
export function resolveAsrGpuPreference(preference: string | undefined | null): AsrGpuInfo {
  const pref = (preference || "auto").trim() || "auto";

  if (process.platform === "darwin") {
    if (pref === "cpu") {
      return { backend: "cpu", deviceLabel: "CPU", kind: "cpu" };
    }
    // auto | metal | any stale cuda/vulkan preference → Metal
    return {
      backend: "metal",
      deviceLabel: "Apple GPU (Metal)",
      kind: "metal",
    };
  }

  if (pref === "auto") return detectAsrGpuInfo();

  if (pref === "cpu") {
    return { backend: "cpu", deviceLabel: "CPU", kind: "cpu" };
  }
  if (pref === "metal") {
    return {
      backend: "metal",
      deviceLabel: "Apple GPU (Metal)",
      kind: "metal",
    };
  }
  if (pref === "cuda") {
    const auto = detectAsrGpuInfo();
    const adapters = process.platform === "win32" ? listWindowsAdapters() : [];
    const vulkanDevices = listVulkanDevices();
    const nvidia = nvidiaNamesFrom(adapters, vulkanDevices);
    return {
      backend: "cuda",
      deviceLabel: nvidia[0] ?? (isNvidiaName(auto.deviceLabel) ? auto.deviceLabel : "NVIDIA GPU"),
      kind: "discrete",
    };
  }

  const vk = /^vulkan:(\d+)$/i.exec(pref);
  if (vk) {
    const id = Number(vk[1]);
    const devices = listVulkanDevices();
    const hit = devices.find((d) => d.index === id);
    if (hit) {
      return {
        backend: "vulkan",
        deviceLabel: hit.name,
        kind: hit.type === "discrete" ? "discrete" : "integrated",
        vulkanDeviceId: hit.index,
      };
    }
    return {
      backend: "vulkan",
      deviceLabel: `Vulkan device ${id}`,
      kind: "discrete",
      vulkanDeviceId: id,
    };
  }

  return detectAsrGpuInfo();
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
    return Boolean(
      tryExec("where.exe", ["vulkaninfo"]) ||
        tryExec("where.exe", ["vulkan-1.dll"]) ||
        existsSync(join(process.env.SystemRoot || "C:\\Windows", "System32", "vulkan-1.dll")),
    );
  }
  if (process.platform === "linux") {
    return Boolean(tryExec("vulkaninfo", ["--summary"]));
  }
  return false;
}

function nvidiaNamesFrom(adapters: string[], vulkan: VulkanDevice[]): string[] {
  const names = [
    ...adapters.filter(isNvidiaName),
    ...vulkan.map((d) => d.name).filter(isNvidiaName),
  ];
  return [...new Set(names)];
}

/**
 * Prefer discrete NVIDIA CUDA → Vulkan (AMD/Intel iGPU or dGPU) → CPU.
 * macOS CrispASR build uses Metal.
 *
 * NVIDIA notes:
 * - CrispASR Windows CUDA targets compute ≥ 7.5 (GTX 16 / RTX 20+).
 * - Older cards (GTX 10 / Pascal) get Vulkan, preferably on a non-NVIDIA adapter.
 * - Hybrid laptops: Win32 may hide NVIDIA while vulkaninfo still lists it — we merge both.
 */
export function detectAsrGpuInfo(): AsrGpuInfo {
  if (process.platform === "darwin") {
    return {
      backend: "metal",
      deviceLabel: "Apple GPU (Metal)",
      kind: "metal",
    };
  }

  const vulkanDevices = listVulkanDevices();
  const vulkanDeviceId = pickVulkanDeviceIndex(vulkanDevices);

  if (process.platform === "win32") {
    const adapters = listWindowsAdapters();
    const best = pickBestAdapter(adapters);
    const nvidia = nvidiaNamesFrom(adapters, vulkanDevices);
    const nvidiaLabel = nvidia[0] ?? null;

    if (nvidiaLabel || hasNvidiaSmi()) {
      const caps = queryNvidiaComputeCaps();
      const estimated = nvidiaLabel ? estimateNvidiaComputeFromName(nvidiaLabel) : null;
      const knownCaps = caps.length ? caps : estimated != null ? [estimated] : [];
      const label = nvidiaLabel ?? best?.name ?? "NVIDIA GPU";
      const cudaOk = nvidiaSupportsBundledCuda(knownCaps);

      if (cudaOk && (hasNvidiaSmi() || estimated == null || estimated >= ASR_CUDA_MIN_COMPUTE)) {
        // Prefer CUDA for Turing+. If nvidia-smi is missing but the name is clearly
        // GTX 16 / RTX, still try CUDA — Vulkan on those cards is often unstable.
        if (hasNvidiaSmi() || (estimated != null && estimated >= ASR_CUDA_MIN_COMPUTE)) {
          return { backend: "cuda", deviceLabel: label, kind: "discrete" };
        }
      }

      // Pre-Turing or CUDA unavailable: Vulkan, but prefer AMD/Intel device if present.
      const vkLabel =
        vulkanDeviceId != null
          ? (vulkanDevices.find((d) => d.index === vulkanDeviceId)?.name ?? label)
          : label;
      return {
        backend: "vulkan",
        deviceLabel: isNvidiaName(vkLabel) ? `${vkLabel} · Vulkan` : vkLabel,
        kind: isNvidiaName(vkLabel) ? "discrete" : classifyAdapter(vkLabel),
        vulkanDeviceId,
      };
    }

    if (best) {
      return {
        backend: "vulkan",
        deviceLabel: best.name,
        kind: best.kind,
        vulkanDeviceId,
      };
    }

    if (vulkanDevices.length) {
      const d =
        vulkanDevices.find((x) => x.index === vulkanDeviceId) ?? vulkanDevices[0]!;
      return {
        backend: "vulkan",
        deviceLabel: d.name,
        kind: d.type === "discrete" ? "discrete" : "integrated",
        vulkanDeviceId: d.index,
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
        vulkanDeviceId,
      };
    }
    if (vulkanDevices.length || hasVulkanRuntime()) {
      const d =
        vulkanDeviceId != null
          ? vulkanDevices.find((x) => x.index === vulkanDeviceId)
          : vulkanDevices[0];
      return {
        backend: "vulkan",
        deviceLabel: d?.name ?? "Vulkan GPU",
        kind: d?.type === "discrete" ? "discrete" : "integrated",
        vulkanDeviceId,
      };
    }
    return { backend: "cpu", deviceLabel: "CPU", kind: "cpu" };
  }

  return { backend: "cpu", deviceLabel: "CPU", kind: "cpu" };
}

/** @deprecated Prefer detectAsrGpuInfo().backend */
export function detectAsrGpuBackend(): AsrGpuBackend {
  return detectAsrGpuInfo().backend;
}

/** True when stderr/stdout is only ggml/CrispASR diagnostic noise (not a real reason). */
export function isAsrDiagnosticOnlyMessage(message: string): boolean {
  const lines = message
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return false;
  return lines.every(
    (l) =>
      /^ggml[_-]/i.test(l) ||
      /crispasr_init_gpu_backend|using preferred GPU backend/i.test(l) ||
      /^load(ing)?\b/i.test(l),
  );
}

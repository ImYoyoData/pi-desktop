import { execFileSync } from "child_process";
import type { AsrGpuBackend, AsrGpuKind } from "../shared/asr";

export type AsrGpuInfo = {
  backend: AsrGpuBackend;
  /** Human-readable adapter name, or "CPU". */
  deviceLabel: string;
  kind: AsrGpuKind;
};

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

function hasNvidiaCuda(): boolean {
  const out = tryExec("nvidia-smi", ["-L"]);
  return Boolean(out && /GPU\s+\d+/i.test(out));
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

    if (hasNvidiaCuda()) {
      const nvidia =
        adapters.find((n) => /nvidia|geforce|rtx|gtx/i.test(n)) ?? best?.name ?? "NVIDIA GPU";
      return { backend: "cuda", deviceLabel: nvidia, kind: "discrete" };
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
    if (hasNvidiaCuda()) {
      return { backend: "cuda", deviceLabel: "NVIDIA GPU", kind: "discrete" };
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

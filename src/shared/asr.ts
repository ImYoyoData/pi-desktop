/** Qwen3-ASR (~0.6–0.7B) local speech-to-text — optional, on-demand install. */

export const ASR_MODEL_ID = "qwen3-asr-0.6b-q4_k";
export const ASR_MODEL_LABEL = "Qwen3-ASR 0.6B (Q4_K)";

/** Approximate sizes shown to the user before install. */
export const ASR_DISK_MB = 640;
export const ASR_RAM_MB = 900;
export const ASR_BINARY_MB = 10;

/** Hugging Face GGUF (single-file CrispASR backend). */
export const ASR_MODEL_FILENAME = "qwen3-asr-0.6b-q4_k.gguf";

/**
 * Model download candidates (tried in order).
 * hf-mirror first: huggingface.co often times out from CN / restricted networks
 * when Electron/Node fetch is used.
 */
export const ASR_MODEL_URLS = [
  `https://hf-mirror.com/cstr/qwen3-asr-0.6b-GGUF/resolve/main/${ASR_MODEL_FILENAME}`,
  `https://huggingface.co/cstr/qwen3-asr-0.6b-GGUF/resolve/main/${ASR_MODEL_FILENAME}`,
] as const;

/** @deprecated Prefer ASR_MODEL_URLS — kept for older imports. */
export const ASR_MODEL_URL = ASR_MODEL_URLS[0];

export const ASR_RELEASE_TAG = "v0.8.23";

/** CrispASR compute backend preference (matches `--gpu-backend`). */
export type AsrGpuBackend = "cuda" | "vulkan" | "metal" | "cpu";

/** Validate / normalize a user-supplied GGUF download URL. */
export function normalizeAsrModelUrl(url: string): string {
  const trimmed = url.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) {
    throw new Error("Invalid ASR model URL (expect http(s) direct link to .gguf)");
  }
  return trimmed;
}

/** Basic extension check for local import. */
export function assertAsrGgufPath(filePath: string): void {
  const lower = filePath.trim().toLowerCase();
  if (!lower.endsWith(".gguf")) {
    throw new Error("Expected a .gguf model file");
  }
}

/** Validate local CrispASR runtime archive; returns archive kind. */
export function assertAsrRuntimeArchivePath(filePath: string): "zip" | "tar.gz" {
  const lower = filePath.trim().toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "tar.gz";
  if (lower.endsWith(".zip")) return "zip";
  throw new Error("Expected a .zip or .tar.gz runtime archive");
}

/** Suggested official archive filename for UI hints. */
export function asrRuntimeArchiveName(
  platform: NodeJS.Platform,
  arch: string,
  backend: AsrGpuBackend,
): string | null {
  const asset = resolveAsrBinaryAsset(platform, arch, backend);
  if (!asset) return null;
  try {
    const pathPart = new URL(asset.url).pathname;
    const name = pathPart.split("/").pop();
    return name || null;
  } catch {
    return null;
  }
}

export type AsrPlatformAsset = {
  url: string;
  archive: "zip" | "tar.gz";
  backend: AsrGpuBackend;
  /** Executable relative path inside extracted folder (best-effort; host may search). */
  binaryNames: string[];
};

/**
 * Resolve CrispASR download for platform + preferred GPU backend.
 * Win: cuda (NVIDIA) → vulkan (AMD/Intel iGPU) → cpu
 * Mac: metal (bundled in macos build)
 * Linux: cuda → vulkan → cpu
 */
export function resolveAsrBinaryAsset(
  platform: NodeJS.Platform,
  arch: string,
  backend: AsrGpuBackend = "cpu",
): AsrPlatformAsset | null {
  const base = `https://github.com/CrispStrobe/CrispASR/releases/download/${ASR_RELEASE_TAG}`;
  const names = ["crispasr.exe", "qwen3-asr-main.exe", "crispasr-main.exe", "crispasr", "bin/crispasr"];

  if (platform === "win32" && (arch === "x64" || arch === "arm64")) {
    if (backend === "cuda") {
      return {
        url: `${base}/crispasr-windows-x86_64-cuda.zip`,
        archive: "zip",
        backend: "cuda",
        binaryNames: names,
      };
    }
    if (backend === "vulkan") {
      return {
        url: `${base}/crispasr-windows-x86_64-vulkan.zip`,
        archive: "zip",
        backend: "vulkan",
        binaryNames: names,
      };
    }
    return {
      url: `${base}/crispasr-windows-x86_64-cpu.zip`,
      archive: "zip",
      backend: "cpu",
      binaryNames: names,
    };
  }

  if (platform === "darwin") {
    return {
      url: `${base}/crispasr-macos.tar.gz`,
      archive: "tar.gz",
      backend: "metal",
      binaryNames: names,
    };
  }

  if (platform === "linux") {
    if (arch === "arm64") {
      return {
        url: `${base}/crispasr-linux-arm64.tar.gz`,
        archive: "tar.gz",
        backend: "cpu",
        binaryNames: names,
      };
    }
    if (backend === "cuda") {
      return {
        url: `${base}/crispasr-linux-x86_64-cuda.tar.gz`,
        archive: "tar.gz",
        backend: "cuda",
        binaryNames: names,
      };
    }
    if (backend === "vulkan") {
      return {
        url: `${base}/crispasr-linux-x86_64-vulkan.tar.gz`,
        archive: "tar.gz",
        backend: "vulkan",
        binaryNames: names,
      };
    }
    return {
      url: `${base}/crispasr-linux-x86_64.tar.gz`,
      archive: "tar.gz",
      backend: "cpu",
      binaryNames: names,
    };
  }

  return null;
}

export type AsrGpuKind = "discrete" | "integrated" | "metal" | "cpu";

/** User-selectable ASR compute target. */
export type AsrGpuOption = {
  /** "auto" | "cuda" | "cpu" | "metal" | "vulkan:<id>" */
  id: string;
  label: string;
  backend: AsrGpuBackend;
  kind: AsrGpuKind;
  vulkanDeviceId?: number;
};

export type AsrStatus = {
  enabled: boolean;
  supported: boolean;
  installed: boolean;
  modelPath: string | null;
  binaryPath: string | null;
  diskMb: number;
  ramMb: number;
  binaryMb: number;
  modelLabel: string;
  /** True only while installing/importing runtime or model — not during transcription. */
  installing: boolean;
  /** True while a transcription job is running. */
  busy: boolean;
  gpuBackend: AsrGpuBackend;
  /** e.g. "AMD Radeon 780M Graphics" or "CPU" */
  gpuDeviceLabel: string;
  gpuKind: AsrGpuKind;
  /** Selected preference id ("auto" or a concrete device). */
  gpuPreference: string;
  /** Devices available for the settings picker. */
  gpuOptions: AsrGpuOption[];
  /** False when installed runtime backend ≠ preferred backend. */
  runtimeMatchesPreference: boolean;
  /** Official archive filename for the preferred backend (manual download hint). */
  runtimeArchiveHint: string | null;
  /** Electron accelerator for wake / start recording (e.g. Control+Alt+Y). */
  wakeHotkey: string;
  lastError: string | null;
};

export type AsrInstallProgress = {
  phase: "binary" | "model" | "extract" | "done" | "error";
  receivedBytes: number;
  totalBytes: number | null;
  message: string;
};

/** Events from CrispASR `--stream --stream-json` (plus lifecycle). */
export type AsrStreamEvent =
  | { type: "ready" }
  | { type: "partial"; utteranceId: number; text: string }
  | { type: "final"; utteranceId: number; text: string }
  | { type: "silence" }
  | { type: "error"; message: string }
  | { type: "ended" };

/**
 * Collapse pathological phrase loops from ASR models
 * (e.g. "我覺得" × 50 on silence/noise). Keeps a single copy of the unit.
 */
export function collapseAsrRepetition(text: string): string {
  const s = text.trim();
  if (s.length < 6) return s;

  const maxUnit = Math.min(40, Math.floor(s.length / 3));
  for (let n = 1; n <= maxUnit; n++) {
    const unit = s.slice(0, n);
    if (!unit) continue;
    // Single-char loops need more repeats (哈哈哈 is fine; 哈哈哈哈哈哈… is not)
    const minRepeats = n === 1 ? 8 : 3;
    let count = 0;
    let i = 0;
    while (i + n <= s.length && s.slice(i, i + n) === unit) {
      count += 1;
      i += n;
    }
    const tail = s.slice(i);
    if (count >= minRepeats && (tail.length === 0 || unit.startsWith(tail))) {
      return unit;
    }
  }
  return s;
}

/** Drop well-known silence/filler hallucinations when they are the entire transcript. */
export function scrubAsrHallucination(text: string): string {
  const collapsed = collapseAsrRepetition(text);
  if (!collapsed) return "";
  if (
    /^(thank you[.!]*|thanks for watching[.!]*|thanks[.!]*|字幕by.*|请不吝点赞.*|訂閱.*|订阅.*)$/iu.test(
      collapsed,
    )
  ) {
    return "";
  }
  return collapsed;
}

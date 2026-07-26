/** Qwen3-ASR (~0.6–0.7B) local speech-to-text — optional, on-demand install. */

export const ASR_MODEL_ID = "qwen3-asr-0.6b-q4_k";
export const ASR_MODEL_LABEL = "Qwen3-ASR 0.6B (Q4_K)";

/** Approximate sizes shown to the user before install. */
export const ASR_DISK_MB = 640;
export const ASR_RAM_MB = 900;
export const ASR_BINARY_MB = 10;

/** Hugging Face GGUF (single-file CrispASR backend). */
export const ASR_MODEL_URL =
  "https://huggingface.co/cstr/qwen3-asr-0.6b-GGUF/resolve/main/qwen3-asr-0.6b-q4_k.gguf";
export const ASR_MODEL_FILENAME = "qwen3-asr-0.6b-q4_k.gguf";

export const ASR_RELEASE_TAG = "v0.8.23";

export type AsrPlatformAsset = {
  url: string;
  archive: "zip" | "tar.gz";
  /** Executable relative path inside extracted folder (best-effort; host may search). */
  binaryNames: string[];
};

export function resolveAsrBinaryAsset(
  platform: NodeJS.Platform,
  arch: string,
): AsrPlatformAsset | null {
  const base = `https://github.com/CrispStrobe/CrispASR/releases/download/${ASR_RELEASE_TAG}`;
  if (platform === "win32" && (arch === "x64" || arch === "arm64")) {
    // CPU build is x64; arm64 Windows can still run via emulation on some devices.
    return {
      url: `${base}/crispasr-windows-x86_64-cpu.zip`,
      archive: "zip",
      binaryNames: ["crispasr.exe", "qwen3-asr-main.exe", "crispasr-main.exe"],
    };
  }
  if (platform === "darwin") {
    return {
      url: `${base}/crispasr-macos.tar.gz`,
      archive: "tar.gz",
      binaryNames: ["crispasr", "qwen3-asr-main", "bin/crispasr"],
    };
  }
  if (platform === "linux") {
    const name =
      arch === "arm64" ? "crispasr-linux-arm64.tar.gz" : "crispasr-linux-x86_64.tar.gz";
    return {
      url: `${base}/${name}`,
      archive: "tar.gz",
      binaryNames: ["crispasr", "qwen3-asr-main", "bin/crispasr"],
    };
  }
  return null;
}

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
  busy: boolean;
  lastError: string | null;
};

export type AsrInstallProgress = {
  phase: "binary" | "model" | "extract" | "done" | "error";
  receivedBytes: number;
  totalBytes: number | null;
  message: string;
};

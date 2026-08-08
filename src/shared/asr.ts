/** SenseVoiceSmall (multilingual CTC, ~234M) local speech-to-text — optional, on-demand install. */

export const ASR_MODEL_ID = "sensevoice-small-q4_k";
export const ASR_MODEL_LABEL = "SenseVoiceSmall (Q4_K)";

/** Approximate sizes shown to the user before install. */
export const ASR_DISK_MB = 140;
export const ASR_RAM_MB = 420;
export const ASR_BINARY_MB = 10;

/** Hugging Face GGUF (single-file CrispASR backend). */
export const ASR_MODEL_FILENAME = "sensevoice-small-q4_k.gguf";

/**
 * Model download candidates (tried in order).
 * Default list prefers hf-mirror (CN-friendly); use asrModelUrlsForMirror() for preference-aware order.
 */
export const ASR_MODEL_URLS = [
  `https://hf-mirror.com/cstr/sensevoice-small-GGUF/resolve/main/${ASR_MODEL_FILENAME}`,
  `https://huggingface.co/cstr/sensevoice-small-GGUF/resolve/main/${ASR_MODEL_FILENAME}`,
] as const;

/** @deprecated Prefer ASR_MODEL_URLS — kept for older imports. */
export const ASR_MODEL_URL = ASR_MODEL_URLS[0];

/**
 * Download mirror preference for ASR runtime (GitHub) and model (Hugging Face).
 * - auto: zh locales prefer China mirrors; otherwise international first
 * - china: CN proxies / hf-mirror first
 * - global: github.com / huggingface.co first
 */
export type AsrDownloadMirror = "auto" | "china" | "global";

export const ASR_DOWNLOAD_MIRRORS: readonly AsrDownloadMirror[] = ["auto", "china", "global"];

export function normalizeAsrDownloadMirror(raw: unknown): AsrDownloadMirror {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v === "china" || v === "global" || v === "auto") return v;
  return "auto";
}

/** Resolve whether China mirrors should be tried before upstream hosts. */
export function asrMirrorChinaFirst(mirror: AsrDownloadMirror, locale = "en"): boolean {
  const pref = normalizeAsrDownloadMirror(mirror);
  if (pref === "china") return true;
  if (pref === "global") return false;
  return locale.toLowerCase().startsWith("zh");
}

/** CN-friendly GitHub release proxies (prefix the full https://github.com/... URL). */
export const ASR_GITHUB_CN_PROXIES = [
  "https://gh.llkk.cc/",
  "https://ghproxy.net/",
  "https://gh-proxy.com/",
  "https://mirror.ghproxy.com/",
  "https://ghfast.top/",
] as const;

/**
 * Expand GitHub release URLs with CN proxies, ordered by mirror preference.
 * Non-GitHub URLs are returned unchanged.
 */
export function expandAsrDownloadUrls(
  urls: readonly string[],
  mirror: AsrDownloadMirror = "auto",
  locale = "en",
): string[] {
  const chinaFirst = asrMirrorChinaFirst(mirror, locale);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u: string): void => {
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  for (const url of urls) {
    const isGithub = /^https?:\/\/(github\.com|objects\.githubusercontent\.com)\//i.test(url);
    if (isGithub) {
      const proxies = ASR_GITHUB_CN_PROXIES.map((base) => `${base}${url}`);
      if (chinaFirst) {
        for (const p of proxies) push(p);
        push(url);
      } else {
        push(url);
        for (const p of proxies) push(p);
      }
    } else {
      push(url);
    }
  }
  return out;
}

/** Hostname shown in install progress (proxy host, not the nested GitHub URL). */
export function asrDownloadSourceHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Model URL candidates ordered by mirror preference. */
export function asrModelUrlsForMirror(mirror: AsrDownloadMirror = "auto", locale = "en"): string[] {
  const cn = `https://hf-mirror.com/cstr/sensevoice-small-GGUF/resolve/main/${ASR_MODEL_FILENAME}`;
  const intl = `https://huggingface.co/cstr/sensevoice-small-GGUF/resolve/main/${ASR_MODEL_FILENAME}`;
  return asrMirrorChinaFirst(mirror, locale) ? [cn, intl] : [intl, cn];
}

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

/** Which ASR backend performs recognition: local CrispASR or a cloud API. */
export type AsrBackendKind = "local" | "cloud" | null;

/**
 * Cloud ASR request format:
 * - openai-multipart: POST {baseUrl}/audio/transcriptions (multipart file + model)
 * - openai-json:      POST {baseUrl}/audio/transcriptions (JSON with base64 data URL)
 * - chat:             POST {baseUrl}/chat/completions with an input_audio message
 *                     (Xiaomi MiMo style; also sends api-key header)
 * - custom:           POST {endpoint} exactly as configured (multipart)
 */
export type AsrCloudApiStyle = "openai-multipart" | "openai-json" | "chat" | "custom";

export type AsrCloudConfig = {
  providerName: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  apiStyle?: AsrCloudApiStyle;
  /** Full endpoint URL used when apiStyle = custom. */
  endpoint?: string;
  /** asr_options.language for chat style (auto / zh / en …). */
  language?: string;
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
  /** Prefer China vs international download mirrors. */
  downloadMirror: AsrDownloadMirror;
  /** Electron accelerator for wake / start recording (e.g. Control+Alt+Y). */
  wakeHotkey: string;
  /**
   * When true (and enabled + installed), keep ASR warm and run always-on
   * local wake-word listening. Default off for privacy.
   */
  residentModel: boolean;
  /** Always-on voice wake-word listening (separate switch from model resident). */
  wakeEnabled: boolean;
  /** Raw wake-word list (comma / newline separated). */
  wakeWords: string;
  lastError: string | null;
  /** Selected recognition backend (null = not chosen yet). */
  backend: AsrBackendKind;
  /** True when a cloud ASR provider is fully configured. */
  cloudConfigured: boolean;
};

export type AsrInstallProgress = {
  phase: "binary" | "model" | "extract" | "done" | "error";
  receivedBytes: number;
  totalBytes: number | null;
  message: string;
  /** Active download host (mirror), when phase is binary/model. */
  sourceHost?: string | null;
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


/**
 * One-shot dictation take sent renderer → main for transcription.
 * Raw 16 kHz s16le PCM (typed array) instead of base64 — encoding a long
 * take on the renderer thread used to freeze the app.
 */
export type AsrTranscribePayload = {
  pcm: Int16Array;
  sampleRate: number;
};

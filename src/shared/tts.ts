/** Piper TTS — optional on-demand install (zh-CN-huayan-medium). */

export const TTS_VOICE_ID = "zh_CN-huayan-medium";
export const TTS_VOICE_LABEL = "Piper zh-CN-huayan-medium";

/** Voice model ≈ 63 MB; runtime zip/tar ≈ 19–22 MB. */
export const TTS_VOICE_DISK_MB = 64;
export const TTS_RUNTIME_DISK_MB = 24;

export const TTS_VOICE_ONNX = `${TTS_VOICE_ID}.onnx`;
export const TTS_VOICE_JSON = `${TTS_VOICE_ID}.onnx.json`;

export const TTS_RELEASE_TAG = "2023.11.14-2";

const VOICE_BASE =
  "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/zh/zh_CN/huayan/medium";
const VOICE_MIRROR =
  "https://hf-mirror.com/rhasspy/piper-voices/resolve/v1.0.0/zh/zh_CN/huayan/medium";

/** Shared across Windows / macOS — download once. */
export const TTS_VOICE_ONNX_URLS = [
  `${VOICE_MIRROR}/${TTS_VOICE_ONNX}`,
  `${VOICE_BASE}/${TTS_VOICE_ONNX}`,
] as const;

export const TTS_VOICE_JSON_URLS = [
  `${VOICE_MIRROR}/${TTS_VOICE_JSON}`,
  `${VOICE_BASE}/${TTS_VOICE_JSON}`,
] as const;

export type TtsPlatformAsset = {
  url: string;
  archive: "zip" | "tar.gz";
  /** Candidate relative paths after extract. */
  binaryNames: string[];
};

export function resolveTtsBinaryAsset(
  platform: NodeJS.Platform,
  arch: string,
): TtsPlatformAsset | null {
  const base = `https://github.com/rhasspy/piper/releases/download/${TTS_RELEASE_TAG}`;
  if (platform === "win32" && (arch === "x64" || arch === "arm64")) {
    return {
      url: `${base}/piper_windows_amd64.zip`,
      archive: "zip",
      binaryNames: ["piper/piper.exe", "piper.exe"],
    };
  }
  if (platform === "darwin") {
    if (arch === "arm64") {
      return {
        url: `${base}/piper_macos_aarch64.tar.gz`,
        archive: "tar.gz",
        binaryNames: ["piper/piper", "piper"],
      };
    }
    if (arch === "x64") {
      return {
        url: `${base}/piper_macos_x64.tar.gz`,
        archive: "tar.gz",
        binaryNames: ["piper/piper", "piper"],
      };
    }
  }
  // Linux optional for future; Electron desktop targets win/mac first.
  if (platform === "linux" && arch === "x64") {
    return {
      url: `${base}/piper_linux_x86_64.tar.gz`,
      archive: "tar.gz",
      binaryNames: ["piper/piper", "piper"],
    };
  }
  return null;
}

export function ttsRuntimeArchiveName(
  platform: NodeJS.Platform,
  arch: string,
): string | null {
  const asset = resolveTtsBinaryAsset(platform, arch);
  if (!asset) return null;
  try {
    return new URL(asset.url).pathname.split("/").pop() || null;
  } catch {
    return null;
  }
}

/** Skip TTS for very long replies (keep latency / cost low). */
export const TTS_MAX_CHARS = 600;

/**
 * Split speakable text into short phrases for pipelined synth+play.
 * Prefers sentence boundaries; falls back to length chops.
 */
export function splitTtsChunks(text: string, maxChunkChars = 80): string[] {
  const cleaned = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  const sentences = cleaned
    .split(/(?<=[。！？!?；;…]|\.(?=\s|$))/)
    .map((s) => s.trim())
    .filter(Boolean);
  const units = sentences.length ? sentences : [cleaned];

  const chunks: string[] = [];
  let buf = "";

  const pushPieces = (s: string) => {
    for (let i = 0; i < s.length; i += maxChunkChars) {
      const piece = s.slice(i, i + maxChunkChars).trim();
      if (piece) chunks.push(piece);
    }
  };

  for (const sentence of units) {
    if (sentence.length > maxChunkChars) {
      if (buf) {
        chunks.push(buf);
        buf = "";
      }
      pushPieces(sentence);
      continue;
    }
    if (!buf) {
      buf = sentence;
      continue;
    }
    if (buf.length + 1 + sentence.length <= maxChunkChars) {
      buf = `${buf} ${sentence}`;
      continue;
    }
    chunks.push(buf);
    buf = sentence;
  }
  if (buf) chunks.push(buf);
  return chunks;
}

/**
 * Keep only speakable prose: drop code fences/blocks, inline code, images,
 * HTML, tables, math, and markdown chrome. Link labels are kept.
 */
export function sanitizeTtsText(raw: string): string {
  let text = String(raw ?? "").replace(/\r\n/g, "\n");

  // Fenced code / diagrams (``` … ```), including language tag and trailing fence.
  text = text.replace(/```[\w+-]*\s*\n[\s\S]*?(?:```|$)/g, "\n");
  text = text.replace(/~~~[\w+-]*\s*\n[\s\S]*?(?:~~~|$)/g, "\n");

  // Indented code blocks (CommonMark: 4 spaces or tab at line start).
  text = text.replace(/^(?: {4}|\t).+$/gm, " ");

  // Math blocks / inline math.
  text = text.replace(/\$\$[\s\S]*?\$\$/g, " ");
  text = text.replace(/(?<!\$)\$(?!\$)([^$\n]+)\$(?!\$)/g, " ");

  // HTML (including <pre>/<code>/<table>/custom).
  text = text.replace(/<pre\b[\s\S]*?<\/pre>/gi, " ");
  text = text.replace(/<code\b[\s\S]*?<\/code>/gi, " ");
  text = text.replace(/<script\b[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style\b[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<[^>]+>/g, " ");

  // Images — never speak alt/url as if it were prose.
  text = text.replace(/!\[[^\]]*]\([^)]*\)/g, " ");
  text = text.replace(/!\[[^\]]*]/g, " ");

  // Links: keep visible label only.
  text = text.replace(/\[([^\]]*)]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]*)]\[[^\]]*]/g, "$1");
  text = text.replace(/<((?:https?:\/\/|mailto:)[^>]+)>/gi, " ");

  // Tables: drop pure separator / pipe-heavy rows.
  text = text.replace(/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/gm, " ");
  text = text.replace(/^\s*\|.+\|\s*$/gm, (row) =>
    row
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean)
      .join("，"),
  );

  // Headings / blockquotes / hr / list markers.
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/^>\s?/gm, "");
  text = text.replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, " ");
  text = text.replace(/^\s*([-*+]|\d+[.)])\s+/gm, "");

  // Inline code (after fences removed).
  text = text.replace(/`[^`\n]+`/g, " ");

  // Emphasis / strikethrough markers (keep inner text).
  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
  text = text.replace(/(\*|_)([^*_\n]+)\1/g, "$2");
  text = text.replace(/~~(.*?)~~/g, "$1");

  // Leftover markdown punctuation noise (not CJK).
  text = text.replace(/[#*_~>`|\\]+/g, " ");

  text = text.replace(/\s+/g, " ").trim();
  if (text.length > TTS_MAX_CHARS) {
    text = `${text.slice(0, TTS_MAX_CHARS).trim()}…`;
  }
  return text;
}

export type TtsInstallProgress = {
  phase: "binary" | "model" | "extract";
  receivedBytes: number;
  totalBytes: number | null;
  message: string;
};

export type TtsStatus = {
  /** Auto-speak final assistant replies (default false). */
  enabled: boolean;
  supported: boolean;
  installed: boolean;
  voicePath: string | null;
  binaryPath: string | null;
  voiceDiskMb: number;
  runtimeDiskMb: number;
  voiceLabel: string;
  installing: boolean;
  speaking: boolean;
  runtimeArchiveHint: string | null;
  lastError: string | null;
};

export type TtsSpeakResult =
  | { ok: true; wavPath: string }
  | { ok: false; message: string };

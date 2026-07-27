import fs from "node:fs";
import path from "node:path";
import { resolveWorkspacePath } from "../shared/path-sandbox";
import type { PreviewResult } from "../shared/preview-types";
import { localMediaSrc } from "./local-file-protocol";

export type { PreviewResult };

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".ico",
  ".avif",
]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".ogg", ".mov", ".m4v"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac", ".opus"]);
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".vue",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".htm",
  ".xml",
  ".svg",
  ".txt",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".env",
  ".go",
  ".rs",
  ".py",
  ".rb",
  ".java",
  ".kt",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".hpp",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".mdx",
  ".log",
  ".csv",
  ".tsv",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".conf",
  ".cfg",
  ".properties",
  ".gradle",
  ".cmake",
  ".makefile",
  ".mk",
  ".r",
  ".php",
  ".swift",
  ".scala",
  ".lua",
  ".pl",
  ".pm",
  ".dart",
  ".zig",
  ".nim",
  ".ex",
  ".exs",
  ".erl",
  ".hrl",
  ".clj",
  ".cljs",
  ".edn",
  ".graphql",
  ".gql",
  ".proto",
  ".tf",
  ".hcl",
  ".nix",
  ".lock",
  ".map",
]);

const MAX_TEXT_BYTES = Math.floor(1.5 * 1024 * 1024);
const SNIFF_BYTES = 8192;

function displayPath(root: string, absolute: string): string {
  const rel = path.relative(root, absolute);
  return rel.split(path.sep).join("/");
}

function mimeForImage(ext: string): string {
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

function looksLikeText(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;
  // NUL → binary
  if (buffer.includes(0)) return false;
  // High ratio of non-text control chars (exclude tab/lf/cr)
  let weird = 0;
  const n = Math.min(buffer.length, SNIFF_BYTES);
  for (let i = 0; i < n; i++) {
    const c = buffer[i]!;
    if (c < 7 || (c > 13 && c < 32) || c === 0x7f) weird += 1;
  }
  return weird / n < 0.3;
}

function readTextFile(absolute: string, maxBytes: number): { content: string; truncated: boolean } {
  const stat = fs.statSync(absolute);
  const toRead = Math.min(stat.size, maxBytes);
  const fd = fs.openSync(absolute, "r");
  try {
    const buffer = Buffer.alloc(toRead);
    fs.readSync(fd, buffer, 0, toRead, 0);
    return {
      content: buffer.toString("utf8"),
      truncated: stat.size > maxBytes,
    };
  } finally {
    fs.closeSync(fd);
  }
}

/** Try unknown / non-listed files as UTF-8 text; reject obvious binaries. */
function tryAsTextFile(absolute: string, relPath: string): PreviewResult {
  const stat = fs.statSync(absolute);
  const sniffLen = Math.min(stat.size, SNIFF_BYTES);
  const fd = fs.openSync(absolute, "r");
  let sniff: Buffer;
  try {
    sniff = Buffer.alloc(sniffLen);
    if (sniffLen > 0) fs.readSync(fd, sniff, 0, sniffLen, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (!looksLikeText(sniff)) {
    return { kind: "unsupported", path: relPath, reason: "binary" };
  }
  const { content, truncated } = readTextFile(absolute, MAX_TEXT_BYTES);
  return { kind: "text", path: relPath, content, truncated: truncated || undefined };
}

export function readPreview(workspaceRoot: string, relativeOrAbsolute: string): PreviewResult {
  const normalizedInput = relativeOrAbsolute.replace(/\\/g, "/");
  let absolute: string;
  try {
    absolute = resolveWorkspacePath(workspaceRoot, relativeOrAbsolute);
  } catch (err) {
    return {
      kind: "error",
      path: normalizedInput,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const relPath = displayPath(path.resolve(workspaceRoot), absolute);

  if (!fs.existsSync(absolute)) {
    return { kind: "error", path: relPath, message: "File not found" };
  }

  const stat = fs.statSync(absolute);
  if (!stat.isFile()) {
    return { kind: "error", path: relPath, message: "Not a file" };
  }

  const ext = path.extname(absolute).toLowerCase();

  if (IMAGE_EXTENSIONS.has(ext)) {
    // Prefer streaming URL for large assets; keep dataUrl for small compatibility.
    const mediaSrc = localMediaSrc(relPath);
    if (stat.size <= 2 * 1024 * 1024) {
      const buffer = fs.readFileSync(absolute);
      const mime = mimeForImage(ext);
      const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
      return { kind: "image", path: relPath, dataUrl, mediaSrc };
    }
    return { kind: "image", path: relPath, dataUrl: mediaSrc, mediaSrc };
  }

  if (VIDEO_EXTENSIONS.has(ext)) {
    return { kind: "video", path: relPath, mediaSrc: localMediaSrc(relPath) };
  }

  if (AUDIO_EXTENSIONS.has(ext)) {
    return { kind: "audio", path: relPath, mediaSrc: localMediaSrc(relPath) };
  }

  if (MARKDOWN_EXTENSIONS.has(ext)) {
    const { content, truncated } = readTextFile(absolute, MAX_TEXT_BYTES);
    return { kind: "markdown", path: relPath, content, truncated: truncated || undefined };
  }

  if (TEXT_EXTENSIONS.has(ext)) {
    const { content, truncated } = readTextFile(absolute, MAX_TEXT_BYTES);
    return { kind: "text", path: relPath, content, truncated: truncated || undefined };
  }

  // Unknown extension → text editor if it looks like text, else binary prompt
  return tryAsTextFile(absolute, relPath);
}

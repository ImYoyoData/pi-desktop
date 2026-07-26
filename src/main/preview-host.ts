import fs from "node:fs";
import path from "node:path";
import { resolveWorkspacePath } from "../shared/path-sandbox";
import type { PreviewResult } from "../shared/preview-types";

export type { PreviewResult };

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
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
]);

const MAX_TEXT_BYTES = Math.floor(1.5 * 1024 * 1024);

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
    default:
      return "application/octet-stream";
  }
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
    const buffer = fs.readFileSync(absolute);
    const mime = mimeForImage(ext);
    const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
    return { kind: "image", path: relPath, dataUrl };
  }

  if (MARKDOWN_EXTENSIONS.has(ext)) {
    const { content, truncated } = readTextFile(absolute, MAX_TEXT_BYTES);
    return { kind: "markdown", path: relPath, content, truncated: truncated || undefined };
  }

  if (TEXT_EXTENSIONS.has(ext)) {
    const { content, truncated } = readTextFile(absolute, MAX_TEXT_BYTES);
    return { kind: "text", path: relPath, content, truncated: truncated || undefined };
  }

  return { kind: "unsupported", path: relPath };
}

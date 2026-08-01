import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Per-session image cache. Every pasted / dropped / URL image attached to a
 * chat message is written into `<sessionJsonl>.attachments/` so the message
 * can reference a real file on disk. The whole folder is removed together
 * with the session (see deleteSessionFile).
 */

export function imageCacheDirFor(filePath: string): string {
  return `${filePath}.attachments`;
}

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
};

function extForMime(mimeType: string): string {
  const m = (mimeType || "").split(";")[0]?.trim().toLowerCase() ?? "";
  return MIME_EXT[m] ?? "img";
}

/** Sniff common image formats from magic bytes (falls back to png). */
function sniffMime(buffer: Buffer): string {
  if (buffer.length >= 8) {
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return "image/png";
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return "image/jpeg";
    }
    if (buffer.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
    if (buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") {
      return "image/webp";
    }
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) return "image/bmp";
  }
  const head = buffer.subarray(0, 256).toString("utf8").trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml";
  return "image/png";
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function writeImageBuffer(
  sessionFile: string,
  mimeType: string,
  buffer: Buffer,
): { filePath: string; mimeType: string } {
  if (buffer.length === 0) throw new Error("image is empty");
  const dir = imageCacheDirFor(sessionFile);
  ensureDir(dir);
  const name = `img-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.${extForMime(mimeType)}`;
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, buffer);
  return { filePath: abs, mimeType };
}

/**
 * Save a base64 data-URL image into the session cache.
 * Returns the absolute cache path and the normalized mime type.
 */
export function saveImageDataUrl(
  sessionFile: string,
  dataUrl: string,
): { filePath: string; mimeType: string } {
  const match = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error("invalid image data URL");
  const mimeType = (match[1] || "image/png").trim().toLowerCase();
  if (!mimeType.startsWith("image/")) throw new Error("not an image data URL");
  const buffer = Buffer.from(match[2], "base64");
  return writeImageBuffer(sessionFile, mimeType, buffer);
}

/**
 * Download a remote image URL into the session cache.
 * Returns the absolute cache path, normalized mime type and the data URL
 * for the renderer to display / hand to the agent.
 */
export async function downloadImageToCache(
  sessionFile: string,
  url: string,
): Promise<{ filePath: string; mimeType: string; dataUrl: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("invalid image URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("unsupported image URL protocol");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let resp: Response;
  try {
    resp = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8,*/*;q=0.1" },
    });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) throw new Error(`failed to download image: HTTP ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.length === 0) throw new Error("downloaded image is empty");
  const contentType = (resp.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const mimeType = /^image\//i.test(contentType) ? contentType : sniffMime(buffer);
  const saved = writeImageBuffer(sessionFile, mimeType, buffer);
  return {
    filePath: saved.filePath,
    mimeType: saved.mimeType,
    dataUrl: `data:${saved.mimeType};base64,${buffer.toString("base64")}`,
  };
}

/** Remove the whole per-session attachment folder (session deleted). */
export function deleteImageCache(filePath: string): void {
  const dir = imageCacheDirFor(filePath);
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

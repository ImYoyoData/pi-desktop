import { app, ipcMain } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { IpcChannels } from "../shared/protocol";
import { netFetch } from "./net-fetch";

/** 只允许拉取头像来源，避免该通道被当成任意 URL 代理。 */
const AVATAR_HOSTS = new Set(["github.com", "avatars.githubusercontent.com"]);
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** 可落盘的头像类型。 */
const IMAGE_TYPES = [
  { ext: ".png", mime: "image/png" },
  { ext: ".jpg", mime: "image/jpeg" },
  { ext: ".webp", mime: "image/webp" },
  { ext: ".gif", mime: "image/gif" },
  { ext: ".avif", mime: "image/avif" },
];

/** 进程内头像缓存：同一地址只请求一次。 */
const avatarCache = new Map<string, string>();

/** 头像缓存目录：打包后位于安装目录 resources/resources/Avatar，开发期位于仓库 resources/Avatar。 */
function avatarDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "resources", "Avatar")
    : join(app.getAppPath(), "resources", "Avatar");
}

/** 由头像地址推导出稳定、可读的缓存文件名（不含扩展名）。 */
function avatarFileName(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    return `${hostname}${pathname}`
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/\.(png|jpe?g|webp|gif|avif)$/i, "");
  } catch {
    return url.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  }
}

async function readDiskAvatar(url: string): Promise<string | null> {
  const base = join(avatarDir(), avatarFileName(url));
  for (const { ext, mime } of IMAGE_TYPES) {
    try {
      const buffer = await readFile(base + ext);
      if (buffer.byteLength > 0 && buffer.byteLength <= MAX_AVATAR_BYTES) {
        return `data:${mime};base64,${buffer.toString("base64")}`;
      }
    } catch {
      // 该扩展名无缓存，继续探测
    }
  }
  return null;
}

async function writeDiskAvatar(url: string, mime: string, buffer: Buffer): Promise<void> {
  const type = IMAGE_TYPES.find((item) => item.mime === mime);
  if (!type) return;
  try {
    const dir = avatarDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, avatarFileName(url) + type.ext), buffer);
  } catch {
    // 安装目录只读时忽略，本次仍有内存缓存
  }
}

function normalizeAvatarUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || !AVATAR_HOSTS.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function loadAvatar(url: string): Promise<string | null> {
  const cached = avatarCache.get(url);
  if (cached) return cached;

  const onDisk = await readDiskAvatar(url);
  if (onDisk) {
    avatarCache.set(url, onDisk);
    return onDisk;
  }

  try {
    const res = await netFetch(url, {
      headers: { Accept: "image/*", "User-Agent": "pi-desktop" },
    });
    if (!res.ok) return null;
    const mime =
      (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!mime.startsWith("image/")) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_AVATAR_BYTES) return null;
    await writeDiskAvatar(url, mime, buffer);
    const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
    avatarCache.set(url, dataUrl);
    return dataUrl;
  } catch {
    // 网络或代理失败：交给渲染进程回退到首字母占位头像
    return null;
  }
}

export function registerContributorsIpc(): void {
  ipcMain.handle(IpcChannels.contributors.avatar, (_event, url: unknown) => {
    const normalized = normalizeAvatarUrl(url);
    return normalized ? loadAvatar(normalized) : null;
  });
}

import { app, ipcMain } from "electron";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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

/** 进程内头像缓存：同一地址只请求一次。data URL 单个可达数 MB，设总量上限避免长期驻留。 */
const AVATAR_CACHE_MAX_BYTES = 8 * 1024 * 1024;
const avatarCache = new Map<string, string>();
let avatarCacheBytes = 0;

/** 记入缓存并按总量淘汰最旧的条目（头像页会累积上百个地址）。 */
function rememberAvatar(url: string, dataUrl: string): void {
  const prev = avatarCache.get(url);
  if (prev !== undefined) {
    avatarCache.delete(url);
    avatarCacheBytes -= prev.length;
  }
  if (dataUrl.length > AVATAR_CACHE_MAX_BYTES) return;
  for (const [key, value] of avatarCache) {
    if (avatarCacheBytes + dataUrl.length <= AVATAR_CACHE_MAX_BYTES) break;
    avatarCache.delete(key);
    avatarCacheBytes -= value.length;
  }
  avatarCache.set(url, dataUrl);
  avatarCacheBytes += dataUrl.length;
}

/** 头像缓存目录：打包后位于安装目录 resources/resources/Avatar，开发期位于仓库 resources/Avatar。 */
function avatarDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "resources", "Avatar")
    : join(app.getAppPath(), "resources", "Avatar");
}

const DISK_AVATAR_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
let diskPruneStarted = false;

/** 磁盘头像按 mtime 保留 30 天：URL 变化留下的旧文件不会无限累积。 */
async function pruneDiskAvatars(): Promise<void> {
  if (diskPruneStarted) return;
  diskPruneStarted = true;
  try {
    const dir = avatarDir();
    const names = await readdir(dir);
    const now = Date.now();
    await Promise.all(
      names.map(async (name) => {
        try {
          const full = join(dir, name);
          const info = await stat(full);
          if (now - info.mtimeMs > DISK_AVATAR_MAX_AGE_MS) {
            await rm(full, { force: true });
          }
        } catch {
          // 单个文件不可读/不可删时跳过
        }
      }),
    );
  } catch {
    // 目录尚未创建或不可读：首次写入时会创建
  }
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
    rememberAvatar(url, onDisk);
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
    rememberAvatar(url, dataUrl);
    return dataUrl;
  } catch {
    // 网络或代理失败：交给渲染进程回退到首字母占位头像
    return null;
  }
}

export function registerContributorsIpc(): void {
  void pruneDiskAvatars();
  ipcMain.handle(IpcChannels.contributors.avatar, (_event, url: unknown) => {
    const normalized = normalizeAvatarUrl(url);
    return normalized ? loadAvatar(normalized) : null;
  });
}

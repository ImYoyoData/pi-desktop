import { ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import { netFetch } from "./net-fetch";

/** 只允许拉取头像来源，避免该通道被当成任意 URL 代理。 */
const AVATAR_HOSTS = new Set(["github.com", "avatars.githubusercontent.com"]);
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** 进程内头像缓存：同一地址只请求一次。 */
const avatarCache = new Map<string, string>();

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

/**
 * 路径 token → workspace 相对路径的解析 —— 纯函数。
 *
 * 拖放、粘贴与 File 读取三处都要走同一套解析，之前内联在 Composer 里：
 * workspace root 与平台大小写敏感性都作为入参传入，便于单测覆盖
 * Windows 盘符、UNC、反斜杠与引号包裹这些边界。
 */

import { looksLikeWorkspaceRelPath } from "./workspace-path-dnd";

export type WorkspacePathContext = {
  /** workspace 根目录，空串表示未打开 workspace。 */
  root: string;
  /** Windows 与默认 macOS APFS 卷大小写不敏感。 */
  caseInsensitive: boolean;
};

/** 优先给文件标签用 workspace 相对路径；命中 root 本身时返回空串。 */
export function toWorkspaceRelative(
  absOrRel: string,
  ctx: WorkspacePathContext,
): string {
  const raw = absOrRel.replace(/\\/g, "/");
  const root = ctx.root.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!root) return raw;
  const fold = (s: string) => (ctx.caseInsensitive ? s.toLowerCase() : s);
  const rootFold = fold(root);
  const pathFold = fold(raw);
  if (pathFold === rootFold) return "";
  if (pathFold.startsWith(`${rootFold}/`)) return raw.slice(root.length + 1);
  return raw;
}

/**
 * file:// URI 或绝对路径 → workspace 相对路径；不是路径形态时返回 null。
 * 命中 workspace 根本身返回空串（调用方据此丢弃）。
 */
export function fileUrlToPath(
  uri: string,
  ctx: WorkspacePathContext,
): string | null {
  const raw = uri.trim();
  if (!raw) return null;
  try {
    if (/^file:\/\//i.test(raw)) {
      const u = new URL(raw);
      let p = decodeURIComponent(u.pathname);
      if (/^\/[A-Za-z]:\//.test(p)) {
        p = p.slice(1).replace(/\//g, "\\");
      }
      return toWorkspaceRelative(p, ctx);
    }
  } catch {
    // fall through
  }
  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("\\\\") || raw.startsWith("/")) {
    return toWorkspaceRelative(raw, ctx);
  }
  return null;
}

/** 绝对路径 / file:// / workspace 相对路径 token → workspace 相对路径。 */
export function coercePathToken(
  raw: string,
  ctx: WorkspacePathContext,
): string | null {
  const fromUrl = fileUrlToPath(raw, ctx);
  if (fromUrl != null && fromUrl !== "") return fromUrl;
  if (fromUrl === "") return null;
  if (looksLikeWorkspaceRelPath(raw)) {
    // Strip quotes wrapping pasted paths that contain spaces.
    return raw
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/\\/g, "/")
      .replace(/^\.\//, "");
  }
  return null;
}

/** 拖放载荷里是否可能带文件（自定义 MIME、文件列表、uri-list 或纯文本路径）。 */
export function transferTypesHaveFilePayload(types: Iterable<string>): boolean {
  const list = Array.from(types);
  return (
    list.includes("application/x-pi-workspace-paths") ||
    list.includes("Files") ||
    list.includes("text/uri-list") ||
    list.includes("text/plain")
  );
}
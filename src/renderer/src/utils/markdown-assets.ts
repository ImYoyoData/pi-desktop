/**
 * markdown 图片地址解析。
 *
 * 相对路径按文档所在目录解析成本地可加载地址（pi-local 协议由主进程读文件），
 * 绝对地址原样保留 —— 远程图片直接交给浏览器加载。
 */
import { isAbsoluteFsPath, joinPath, normalizePath, relativePath } from "./fs-path";

/** 本地资源协议前缀：主进程 pi-local 负责把工作区文件读出来。 */
const LOCAL_MEDIA_PREFIX = "pi-local://media/";

/** 带协议的地址：http(s)/data/blob/pi-* 等。 */
const SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

/** Windows 盘符不能当协议处理。 */
const DRIVE_RE = /^[a-zA-Z]:/;

export type MarkdownAssetBase = {
  /** markdown 文档所在目录（绝对路径）。 */
  dir: string;
  /** 工作区根目录（绝对路径）：命中时按工作区相对地址交给主进程做沙箱校验。 */
  root?: string | null;
};

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function fileUrlToPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    let p = decodeURIComponent(parsed.pathname);
    if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
    return p || null;
  } catch {
    return null;
  }
}

/** 本地文件 → 渲染进程可加载的地址；工作区内按相对地址交给主进程做沙箱校验。 */
export function localFileSrc(target: string, root?: string | null): string {
  const rel = root ? relativePath(root, target) : null;
  const value = rel ?? target;
  return `${LOCAL_MEDIA_PREFIX}?p=${encodeURIComponent(value)}`;
}

/**
 * 解析 markdown 里的图片地址；解析不了时返回 null，调用方保留原地址。
 */
export function resolveMarkdownImageSrc(
  href: string,
  base: MarkdownAssetBase | null,
): string | null {
  const raw = href.trim();
  if (!raw) return null;
  // 协议相对地址按 https 处理。
  if (raw.startsWith("//")) return `https:${raw}`;
  const decoded = decodeSafe(raw);
  // 本地绝对路径：Windows 盘符不能当协议处理。
  if (isAbsoluteFsPath(decoded) || DRIVE_RE.test(decoded)) {
    return localFileSrc(normalizePath(decoded), base?.root);
  }
  if (SCHEME_RE.test(raw)) {
    if (/^file:/i.test(raw)) {
      const p = fileUrlToPath(raw);
      return p ? localFileSrc(normalizePath(p), base?.root) : null;
    }
    return raw;
  }
  if (!base?.dir) return null;
  return localFileSrc(joinPath(base.dir, decoded), base.root);
}

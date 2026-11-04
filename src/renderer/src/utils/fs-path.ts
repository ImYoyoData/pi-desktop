/**
 * 渲染进程的路径工具。
 *
 * 渲染进程没有 node:path，这里只实现拼接、归一化与相对化，
 * 语义对齐 node:path 的 posix/win32 常用子集。
 */

export type PathParts = {
  /** 根：盘符（"C:"）、UNC（"//"）、POSIX 根（"/"）；相对路径为空串。 */
  root: string;
  segments: string[];
};

function segmentsOf(value: string): string[] {
  return value.split("/").filter((s) => s !== "" && s !== ".");
}

function buildPath(root: string, segments: string[]): string {
  const joined = segments.join("/");
  if (root === "//") return `//${joined}`;
  if (root === "/") return `/${joined}`;
  if (root) return `${root}/${joined}`;
  return joined;
}

export function splitPath(path: string): PathParts {
  const norm = path.replace(/\\/g, "/");
  if (/^[a-zA-Z]:/.test(norm)) {
    return { root: norm.slice(0, 2), segments: segmentsOf(norm.slice(2)) };
  }
  if (norm.startsWith("//")) {
    return { root: "//", segments: segmentsOf(norm.slice(2)) };
  }
  return { root: norm.startsWith("/") ? "/" : "", segments: segmentsOf(norm) };
}

/** 单个行范围：`12`、`1-20`、`50-`、`10+5`，以及 pi 的 `L12`、`2724..2727` 写法。 */
const RANGE_CHUNK = String.raw`L?\d+(?:(?:\.\.|[-+])L?\d*)?`;
/** 尾部范围：`:-15` 表示最后 15 行。 */
const TAIL_CHUNK = String.raw`-\d+(?:[-+]\d+)?`;
/** 选择器片段：`:raw`、`:conflicts`、`:img`，或逗号分隔的行范围列表。 */
const SELECTOR_CHUNK = new RegExp(
  String.raw`^(?:raw|conflicts|img|(?:${RANGE_CHUNK}|${TAIL_CHUNK})(?:,(?:${RANGE_CHUNK}|${TAIL_CHUNK}))*)$`,
  "i",
);

/**
 * read 工具允许把选择器内联在路径里（`:12`、`:1-20`、`:19,59`、`:raw`、`:raw:50-100`）。
 * 取文件名/扩展名前先剥掉，否则扩展名会被后缀污染（`a.ts:1-20` → `ts:1-20`）。
 */
export function stripLineSelector(path: string): string {
  let out = path;
  // 复合选择器最多两段（`:raw:50-100`），逐段从尾部剥离。
  for (let i = 0; i < 2; i++) {
    const idx = out.lastIndexOf(":");
    if (idx <= 0) break;
    if (!SELECTOR_CHUNK.test(out.slice(idx + 1))) break;
    out = out.slice(0, idx);
  }
  return out;
}

/** 绝对路径判定：POSIX 根或 Windows 盘符。 */
export function isAbsoluteFsPath(path: string): boolean {
  const norm = path.replace(/\\/g, "/");
  return norm.startsWith("/") || /^[a-zA-Z]:\//.test(norm);
}

/** 拼接相对路径并吃掉 . 与 ..。 */
export function joinPath(base: string, relative: string): string {
  const { root, segments } = splitPath(base);
  const out = segments.slice();
  for (const seg of relative.replace(/\\/g, "/").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return buildPath(root, out);
}

/** 归一化路径（吃掉 . 与 ..）。 */
export function normalizePath(path: string): string {
  const { root, segments } = splitPath(path);
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === "..") {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return buildPath(root, out);
}

/** 所在目录；没有上级目录时返回空串。 */
export function parentDir(path: string): string {
  const { root, segments } = splitPath(path);
  return buildPath(root, segments.slice(0, -1));
}

/** target 相对 root 的路径；不在 root 内（含 root 本身）返回 null。 */
export function relativePath(root: string, target: string): string | null {
  const r = splitPath(root);
  const t = splitPath(target);
  if (r.root !== t.root) return null;
  let i = 0;
  while (i < r.segments.length && i < t.segments.length && r.segments[i] === t.segments[i]) i++;
  if (i < r.segments.length) return null;
  const rest = t.segments.slice(i);
  if (rest.length === 0) return null;
  return rest.join("/");
}

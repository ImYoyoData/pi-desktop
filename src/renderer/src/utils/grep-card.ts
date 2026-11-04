/**
 * grep 工具结果的逐行解析。
 *
 * pi 的 grep 输出 `path:12: 文本`（命中）与 `path-13- 文本`（context）；
 * omp 的 grep 输出 `*12|文本`（命中）与 ` 12|文本`（context），目录搜索时
 * 还带 `# 目录/`、`## 文件` 的层级头。两种都还原成可分组渲染的结构。
 */

import { joinPath } from "./fs-path";
import { splitTrailingNotice } from "./structured-text";

/** 命中路径的基准：pi 相对搜索目录，omp 相对会话工作区。 */
export type GrepPathBase = "search" | "workspace";

export type GrepLine = {
  line: number;
  text: string;
  /** 命中行；context 行为 false。 */
  match: boolean;
  /** omp 的 `...`：被跳过的上下文间隔，不占行号。 */
  gap?: boolean;
};

export type GrepFileHits = {
  /** grep 输出里的路径：相对搜索目录、相对工作区，或 path 指向单个文件时的 basename。 */
  path: string;
  pathBase: GrepPathBase;
  lines: GrepLine[];
};

export type ParsedGrepOutput = {
  hits: GrepFileHits[];
  /** pi 追加在输出尾部的提示（匹配上限 / 字节截断 / 单行截断），原文保留。 */
  notices: string[];
  matchCount: number;
  noMatches: boolean;
  /** 剥掉尾部提示后的文本：解析不出命中时按纯文本显示。 */
  text: string;
};

/**
 * 路径本身可能含冒号与连字符，所以从最短前缀开始试，
 * 且要求两个分隔符一致（命中是 `:`，context 是 `-`）。
 */
const GREP_LINE_RE = /^(.+?)([:\-])(\d+)\2 (.*)$/;

/** omp：marker + 行号 + 分隔符 + 内容；`*` 命中、空格 context，hashline 模式用 `:`。 */
const OMP_LINE_RE = /^([* ])(\d+)([|:])(.*)$/;

/** omp 分组头：`# 目录/`、`## 文件.ts`，`#` 数量即层级。 */
const OMP_HEADER_RE = /^(#+)\s+(.*)$/;
const OMP_HEADER_SUFFIX_RE = /\s+\([^)]*\)\s*$/;
/** hashline 模式的文件头 `[path#TAG]`：单独一行，不是截断提示。 */
const OMP_HASHLINE_FILE_RE = /^\[(.+)#[0-9A-F]{4}\]$/;
/** hashline 模式的文件头带 `#` + 4 位大写十六进制内容指纹。 */
const OMP_HASHLINE_TAG_RE = /#[0-9A-F]{4}$/;
const OMP_GAP = "...";

/** 尾部提示：pi 在输出末尾追加 `\n\n[...]`。 */
const NO_MATCHES = "No matches found";

function ompHeaderName(rest: string): string {
  const bare = rest.replace(OMP_HASHLINE_TAG_RE, "");
  return bare.startsWith("[") && bare.endsWith("]") ? bare.slice(1, -1) : bare;
}

/** omp 输出：无分组头时路径就是调用方传入的搜索根或单文件路径。 */
function parseOmpOutput(
  lines: string[],
  searchPath: string | null,
): { hits: GrepFileHits[]; matchCount: number; notices: string[] } | null {
  if (!lines.some((line) => OMP_LINE_RE.test(line))) return null;

  const hits: GrepFileHits[] = [];
  const notices: string[] = [];
  const dirs: string[] = [];
  let path = searchPath ?? "";
  let matchCount = 0;

  const group = (): GrepFileHits => {
    const last = hits[hits.length - 1];
    if (last && last.path === path) return last;
    const created: GrepFileHits = { path, pathBase: "workspace", lines: [] };
    hits.push(created);
    return created;
  };

  for (const line of lines) {
    const fileHeader = OMP_HASHLINE_FILE_RE.exec(line);
    if (fileHeader) {
      dirs.length = 0;
      path = fileHeader[1]!;
      continue;
    }
    const header = OMP_HEADER_RE.exec(line);
    if (header) {
      const depth = header[1]!.length;
      const rest = header[2]!.trimEnd().replace(OMP_HEADER_SUFFIX_RE, "");
      dirs.length = depth - 1;
      if (rest.endsWith("/")) {
        dirs.push(rest);
        path = "";
      } else {
        path = dirs.join("") + ompHeaderName(rest);
      }
      continue;
    }
    if (line.trim() === OMP_GAP) {
      if (path) group().lines.push({ line: 0, text: "", match: false, gap: true });
      continue;
    }
    const row = OMP_LINE_RE.exec(line);
    if (!row) {
      if (line.trim()) notices.push(line.trim());
      continue;
    }
    const match = row[1] === "*";
    group().lines.push({ line: Number(row[2]), text: row[4]!, match });
    if (match) matchCount += 1;
  }

  return { hits, matchCount, notices };
}

export function parseGrepOutput(
  raw: string,
  searchPath: string | null = null,
): ParsedGrepOutput {
  const { text, notices: trailing } = splitTrailingNotice(raw);
  const lines = text.split("\n");
  const hits: GrepFileHits[] = [];
  const notices = [...trailing];
  let matchCount = 0;

  const omp = parseOmpOutput(lines, searchPath);
  if (omp) {
    hits.push(...omp.hits);
    matchCount = omp.matchCount;
    notices.push(...omp.notices);
  } else {
    for (const line of lines) {
      const parsed = GREP_LINE_RE.exec(line);
      if (!parsed) continue;
      const path = parsed[1]!;
      const match = parsed[2] === ":";
      const last = hits[hits.length - 1];
      if (!last || last.path !== path) hits.push({ path, pathBase: "search", lines: [] });
      hits[hits.length - 1]!.lines.push({ line: Number(parsed[3]), text: parsed[4]!, match });
      if (match) matchCount += 1;
    }
  }

  return {
    hits,
    notices,
    matchCount,
    // 工具偏好会在空结果后面追加 .gitignore 说明，所以只认开头这句。
    noMatches: text.trimStart().startsWith(NO_MATCHES),
    text,
  };
}

/**
 * grep 输出路径 → 可预览路径。
 *
 * path 是目录时 pi 输出相对该目录的路径，需要拼回工作区；path 是文件时
 * pi 退化成 basename，这时文件就是 path 本身。
 *
 * omp 的输出路径本来就相对会话工作区，再拼搜索目录会重复。
 */
export function grepOpenPath(
  searchPath: string | null,
  filePath: string,
  pathBase: GrepPathBase = "search",
): string {
  if (pathBase === "workspace") return filePath;
  if (!searchPath) return filePath;
  const base = searchPath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!base || base === ".") return filePath;
  const name = base.split("/").pop() ?? "";
  // path 指向单个文件时 pi 把输出退化成 basename，不靠扩展名也应认出来。
  // shortcut: 命中路径恰好等于目录名时（目录 deploy 里搜到 deploy/deploy）无从区分，
  // 这里按单文件处理；要区分得由调用方传入路径类型。
  if (name === filePath) return base;
  return joinPath(base, filePath);
}

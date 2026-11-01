/**
 * grep 工具结果的逐行解析。
 *
 * pi 的 grep 输出 `path:12: 文本`（命中）与 `path-13- 文本`（context），
 * 直接当纯文本糊出来会丢掉文件分组与行号 —— 这里还原成可分组渲染的结构。
 */

import { joinPath } from "./fs-path";
import { splitTrailingNotice } from "./structured-text";

export type GrepLine = {
  line: number;
  text: string;
  /** 命中行；context 行为 false。 */
  match: boolean;
};

export type GrepFileHits = {
  /** grep 输出里的路径：相对搜索目录，或 path 指向单个文件时的 basename。 */
  path: string;
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

/** 尾部提示：pi 在输出末尾追加 `\n\n[...]`。 */
const NO_MATCHES = "No matches found";

export function parseGrepOutput(raw: string): ParsedGrepOutput {
  const { text, notices } = splitTrailingNotice(raw);

  const hits: GrepFileHits[] = [];
  let matchCount = 0;
  for (const line of text.split("\n")) {
    const parsed = GREP_LINE_RE.exec(line);
    if (!parsed) continue;
    const path = parsed[1]!;
    const match = parsed[2] === ":";
    const last = hits[hits.length - 1];
    if (!last || last.path !== path) hits.push({ path, lines: [] });
    hits[hits.length - 1]!.lines.push({ line: Number(parsed[3]), text: parsed[4]!, match });
    if (match) matchCount += 1;
  }

  return {
    hits,
    notices,
    matchCount,
    noMatches: text.trim() === NO_MATCHES,
    text,
  };
}

/**
 * grep 输出路径 → 可预览路径。
 *
 * path 是目录时 pi 输出相对该目录的路径，需要拼回工作区；path 是文件时
 * pi 退化成 basename，这时文件就是 path 本身。
 */
export function grepOpenPath(searchPath: string | null, filePath: string): string {
  if (!searchPath) return filePath;
  const base = searchPath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!base || base === ".") return filePath;
  const name = base.split("/").pop() ?? "";
  if (name === filePath && /\.[A-Za-z0-9]+$/.test(name)) return base;
  return joinPath(base, filePath);
}

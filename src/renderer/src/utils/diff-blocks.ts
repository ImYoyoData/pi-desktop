/**
 * unified diff 解析 —— 把补丁文本拆成 hunk 与行，变更块内按行配对并跑词级 diff。
 */

import {
  tokenizeForDiff,
  wordDiff,
  WORD_DIFF_MAX_TOKENS,
  type DiffToken,
} from "./word-diff";

export type DiffLineKind = "ctx" | "add" | "del";

export type DiffLine = {
  kind: DiffLineKind;
  text: string;
  /** 词级标记：只在配对过的 add/del 行上给出。 */
  oldParts?: DiffToken[];
  newParts?: DiffToken[];
};

export type DiffHunk = {
  header: string;
  lines: DiffLine[];
};

export type ParsedDiff = {
  hunks: DiffHunk[];
  /** 没有 hunk 头，说明这不是 unified diff，调用方应退回纯文本。 */
  plain: boolean;
};

/**
 * 参与词级比对的行对上限：每对是 O(n·m) 的 DP，
 * 大补丁里几百对一起算会占满渲染线程，超限后改成整行标记。
 */
const WORD_DIFF_MAX_PAIRS = 200;

function pairLines(dels: string[], adds: string[], budget: { pairs: number }): DiffLine[] {
  const out: DiffLine[] = [];
  const pairs = Math.min(dels.length, adds.length);
  for (let k = 0; k < pairs; k++) {
    const oldText = dels[k]!;
    const newText = adds[k]!;
    const tooLong =
      tokenizeForDiff(oldText).length > WORD_DIFF_MAX_TOKENS ||
      tokenizeForDiff(newText).length > WORD_DIFF_MAX_TOKENS;
    if (tooLong || budget.pairs >= WORD_DIFF_MAX_PAIRS) {
      out.push({ kind: "del", text: oldText });
      out.push({ kind: "add", text: newText });
      continue;
    }
    budget.pairs += 1;
    const diff = wordDiff(oldText, newText);
    out.push({ kind: "del", text: oldText, oldParts: diff.old });
    out.push({ kind: "add", text: newText, newParts: diff.new });
  }
  for (let k = pairs; k < dels.length; k++) out.push({ kind: "del", text: dels[k]! });
  for (let k = pairs; k < adds.length; k++) out.push({ kind: "add", text: adds[k]! });
  return out;
}

/**
 * 解析 unified diff。
 *
 * 变更块内「连续的删除行」与「连续的新增行」按下标配对，逐对跑词级 diff；
 * 数量不等时多出来的那几行整行标记（没有可配对的旧行可比）。
 */
export function parseUnifiedDiff(raw: string): ParsedDiff {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  const budget = { pairs: 0 };
  const lines = raw.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("@@")) {
      current = { header: line, lines: [] };
      hunks.push(current);
      i++;
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      i++;
      continue;
    }
    if (line.startsWith("-") || line.startsWith("+")) {
      const dels: string[] = [];
      const adds: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("-")) dels.push(lines[i++]!.slice(1));
      while (i < lines.length && lines[i]!.startsWith("+")) adds.push(lines[i++]!.slice(1));
      if (!current) {
        current = { header: "", lines: [] };
        hunks.push(current);
      }
      current.lines.push(...pairLines(dels, adds, budget));
      continue;
    }
    if (current) current.lines.push({ kind: "ctx", text: line });
    i++;
  }
  return { hunks, plain: hunks.length === 0 || hunks.every((hunk) => !hunk.header) };
}

/** 补丁里的增删行数，用于卡片头部的 +N/−N。 */
export function countDiffLines(hunks: DiffHunk[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "add") added++;
      else if (line.kind === "del") removed++;
    }
  }
  return { added, removed };
}

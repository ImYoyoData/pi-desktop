/**
 * unified diff 解析 —— 把补丁文本拆成 hunk 与行，变更块内按行配对并跑词级 diff。
 */

import {
  tokenizeForDiff,
  wordDiffTokens,
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
 * 参与词级比对的行对上限。实测 1500 对普通代码行只需 3ms，
 * 上限只用来兜住极端补丁（每行都接近 minified），正常 diff 不会触到。
 */
const WORD_DIFF_MAX_PAIRS = 4000;

/** 解析结果缓存：滚动出入视口、面板重开都不再重解析。 */
const PARSE_CACHE_MAX = 8;
const parseCache = new Map<string, ParsedDiff>();

/** `diff --git` 与第一个 hunk 之间的文件级元信息，审阅时没有价值。 */
const FILE_META_RE =
  /^(?:index |old mode |new mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |new file mode |deleted file mode )/;

function pairLines(dels: string[], adds: string[], budget: { pairs: number }): DiffLine[] {
  const out: DiffLine[] = [];
  const pairs = Math.min(dels.length, adds.length);
  for (let k = 0; k < pairs; k++) {
    const oldText = dels[k]!;
    const newText = adds[k]!;
    // 分词只做一次：长度判断与后续比对共用同一份 token。
    const oldTokens = tokenizeForDiff(oldText);
    const newTokens = tokenizeForDiff(newText);
    if (budget.pairs >= WORD_DIFF_MAX_PAIRS) {
      out.push({ kind: "del", text: oldText });
      out.push({ kind: "add", text: newText });
      continue;
    }
    budget.pairs += 1;
    const diff = wordDiffTokens(oldTokens, newTokens);
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
  const cached = parseCache.get(raw);
  if (cached) return cached;
  const parsed = parseUncached(raw);
  if (parseCache.size >= PARSE_CACHE_MAX) parseCache.clear();
  parseCache.set(raw, parsed);
  return parsed;
}

function parseUncached(raw: string): ParsedDiff {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  const budget = { pairs: 0 };
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  /** 是否在某个 hunk 正文里：正文里的 "--- " 是被删除的行，不是文件头。 */
  let inHunk = false;
  /** 是否还没走到第一个 hunk：期间只有文件级元信息。 */
  let inFileHeader = false;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("@@")) {
      inHunk = true;
      inFileHeader = false;
      current = { header: line, lines: [] };
      hunks.push(current);
      i++;
      continue;
    }
    if (line.startsWith("diff --git ")) {
      // 新文件：回到文件头模式，后面紧跟的 --- / +++ 是文件头。
      inHunk = false;
      inFileHeader = true;
      current = { header: "", lines: [{ kind: "ctx", text: line }] };
      hunks.push(current);
      i++;
      continue;
    }
    /**
     * `--- ` / `+++ ` 是文件头，但只在 hunk 正文之外。
     * hunk 内部以这三个字符开头的行是「删除了一行以 --- 开头的文本」，
     * 当成文件头丢掉就会少显示一行。
     *
     * 没有 `diff --git` 的多文件补丁，第二个文件头后面紧跟 `+++` 与 `@@`，
     * 据此退出 hunk 正文，避免把文件头算成增删行。
     */
    if (
      inHunk &&
      line.startsWith("--- ") &&
      lines[i + 1]?.startsWith("+++ ") &&
      lines[i + 2]?.startsWith("@@")
    ) {
      inHunk = false;
      current = null;
    }
    if (!inHunk && (line.startsWith("--- ") || line.startsWith("+++ "))) {
      i++;
      continue;
    }
    if (!inHunk && inFileHeader && FILE_META_RE.test(line)) {
      i++;
      continue;
    }
    if (line.startsWith("-") || line.startsWith("+")) {
      const dels: string[] = [];
      const adds: string[] = [];
      while (i < lines.length) {
        const next = lines[i]!;
        if (
          next.startsWith("--- ") &&
          lines[i + 1]?.startsWith("+++ ") &&
          lines[i + 2]?.startsWith("@@")
        ) {
          break;
        }
        const marker = next.charAt(0);
        if (marker === "-") dels.push(lines[i++]!.slice(1));
        else if (marker === "+") adds.push(lines[i++]!.slice(1));
        else break;
      }
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

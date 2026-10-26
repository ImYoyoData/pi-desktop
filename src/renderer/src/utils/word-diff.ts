/**
 * 词级 diff —— 手写的 token 级 LCS，不引第三方 diff 依赖。
 *
 * 逐行比对 unified diff 只能看出「整行变了」；词级比对才能指出「哪几个词被改了」，
 * 这正是编辑类工具结果里最有价值的信息。
 */

/** 词级 diff 的一个片段；changed = true 表示它不是两侧共有的部分。 */
export type DiffToken = { text: string; changed: boolean };

export type WordDiffResult = {
  old: DiffToken[];
  new: DiffToken[];
};

/**
 * 变化区间内单侧 token 数上限。LCS 是 O(n·m)，
 * 超长行（压缩后的代码、minified 文件）会把渲染线程卡住。
 */
export const WORD_DIFF_MAX_TOKENS = 300;

/** 变化区间内的 DP 单元格上限；超过就退化成整行标记。 */
const MAX_DIFF_CELLS = WORD_DIFF_MAX_TOKENS * WORD_DIFF_MAX_TOKENS;

/** 拆成「词 + 空白」：空白参与比对，缩进变化也会被标出来。 */
export function tokenizeForDiff(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token !== "");
}

/** 相邻同类片段合并：同样的高亮，更少的 DOM 节点。 */
function push(out: DiffToken[], text: string, changed: boolean): void {
  const last = out[out.length - 1];
  if (last && last.changed === changed) last.text += text;
  else out.push({ text, changed });
}

/**
 * 两侧文本的词级差异。
 *
 * 输入的两行必须已经配对好（同一个变更块里下标相同的删除行与新增行）；
 * 没有公共 token 时整行都会被标成改动，这是正确的退化行为。
 */
export function wordDiff(oldText: string, newText: string): WordDiffResult {
  return wordDiffTokens(tokenizeForDiff(oldText), tokenizeForDiff(newText));
}

/**
 * 已分词的文本做词级比对。
 *
 * 先裁掉公共前后缀，只对真正变化的中段跑 DP：真实编辑往往只有几个 token
 * 不同，裁剪后 DP 规模接近常数，长篇补丁也能逐行给词级高亮。
 */
export function wordDiffTokens(a: string[], b: string[]): WordDiffResult {
  const oldOut: DiffToken[] = [];
  const newOut: DiffToken[] = [];

  let start = 0;
  const limit = Math.min(a.length, b.length);
  while (start < limit && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  for (let i = 0; i < start; i += 1) {
    push(oldOut, a[i]!, false);
    push(newOut, b[i]!, false);
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length * midB.length > MAX_DIFF_CELLS) {
    for (const token of midA) push(oldOut, token, true);
    for (const token of midB) push(newOut, token, true);
  } else if (midA.length && midB.length) {
    const n = midA.length;
    const m = midB.length;
    const width = m + 1;
    const dp = new Uint16Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i -= 1) {
      const row = i * width;
      const nextRow = row + width;
      for (let j = m - 1; j >= 0; j -= 1) {
        dp[row + j] =
          midA[i] === midB[j]
            ? dp[nextRow + j + 1]! + 1
            : Math.max(dp[nextRow + j]!, dp[row + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        push(oldOut, midA[i]!, false);
        push(newOut, midB[j]!, false);
        i += 1;
        j += 1;
      } else if (dp[(i + 1) * width + j]! >= dp[i * width + j + 1]!) {
        push(oldOut, midA[i]!, true);
        i += 1;
      } else {
        push(newOut, midB[j]!, true);
        j += 1;
      }
    }
    for (; i < n; i += 1) push(oldOut, midA[i]!, true);
    for (; j < m; j += 1) push(newOut, midB[j]!, true);
  } else {
    for (const token of midA) push(oldOut, token, true);
    for (const token of midB) push(newOut, token, true);
  }

  for (let i = endA; i < a.length; i += 1) push(oldOut, a[i]!, false);
  for (let j = endB; j < b.length; j += 1) push(newOut, b[j]!, false);

  return { old: oldOut, new: newOut };
}

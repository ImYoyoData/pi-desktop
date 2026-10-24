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
 * 单行 token 数上限。LCS 是 O(n·m)，超长行（压缩后的代码、minified 文件）
 * 会把渲染线程卡住，超限就退化成整行标记。
 */
export const WORD_DIFF_MAX_TOKENS = 300;

/** 拆成「词 + 空白」：空白参与比对，缩进变化也会被标出来。 */
export function tokenizeForDiff(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token !== "");
}

/**
 * 两侧文本的词级差异。
 *
 * 输入的两行必须已经配对好（同一个变更块里下标相同的删除行与新增行）；
 * 没有公共 token 时整行都会被标成改动，这是正确的退化行为。
 */
export function wordDiff(oldText: string, newText: string): WordDiffResult {
  const a = tokenizeForDiff(oldText);
  const b = tokenizeForDiff(newText);
  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const oldOut: DiffToken[] = [];
  const newOut: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      oldOut.push({ text: a[i]!, changed: false });
      newOut.push({ text: b[j]!, changed: false });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      oldOut.push({ text: a[i]!, changed: true });
      i++;
    } else {
      newOut.push({ text: b[j]!, changed: true });
      j++;
    }
  }
  while (i < n) oldOut.push({ text: a[i++]!, changed: true });
  while (j < m) newOut.push({ text: b[j++]!, changed: true });
  return { old: oldOut, new: newOut };
}

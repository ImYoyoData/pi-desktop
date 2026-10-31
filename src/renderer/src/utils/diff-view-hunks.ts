/**
 * 把工具卡片里的 unified diff 归一化成 diffs 能解析的形状。
 *
 * pi 的补丁里 hunk 头常常是裸的 `@@`（工具卡片的 diff 在解析阶段就是这么造的），
 * 而库要求 `@@ -a,b +c,d @@`，缺行号会直接抛 `Invalid hunk header format`。
 * 这里按前一个块的增删行数推算行号，把裸头补全。
 */

const HUNK_HEAD_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function hunkLengths(block: string[]): { oldLines: number; newLines: number } {
  let ctx = 0;
  let del = 0;
  let add = 0;
  for (const line of block) {
    const marker = line.charAt(0);
    if (marker === " ") ctx += 1;
    else if (marker === "-") del += 1;
    else if (marker === "+") add += 1;
  }
  return { oldLines: ctx + del, newLines: ctx + add };
}

/**
 * 返回可直接喂给 `DiffView` 的 hunk 文本；没有 hunk 时返回 null，调用方退回纯文本。
 */
export function normalizeDiffHunks(text: string, path: string | null): string | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const label = (path ?? "file").replace(/\\/g, "/");
  const out: string[] = [];
  if (!lines.some((line) => line.startsWith("--- "))) {
    out.push(`--- a/${label}`, `+++ b/${label}`);
  }

  let oldStart = 1;
  let newStart = 1;
  let sawHunk = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const head = HUNK_HEAD_RE.exec(line);
    if (head) {
      oldStart = Number(head[1]) + Number(head[2] ?? 1);
      newStart = Number(head[3]) + Number(head[4] ?? 1);
      sawHunk = true;
      out.push(line);
      continue;
    }
    if (line.trimEnd() !== "@@") {
      out.push(line);
      continue;
    }
    const block: string[] = [];
    while (i + 1 < lines.length && !HUNK_HEAD_RE.test(lines[i + 1]!)) {
      if (lines[i + 1]!.trimEnd() === "@@") break;
      block.push(lines[++i]!);
    }
    const { oldLines, newLines } = hunkLengths(block);
    out.push(`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`);
    out.push(...block);
    oldStart += oldLines;
    newStart += newLines;
    sawHunk = true;
  }

  return sawHunk ? out.join("\n") : null;
}

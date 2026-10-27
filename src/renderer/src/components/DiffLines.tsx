import { memo, useMemo, type ReactNode } from "react";
import { parseUnifiedDiff, type DiffLine } from "@renderer/utils/diff-blocks";
import styles from "./DiffLines.module.css";

const DiffLineRow = memo(function DiffLineRow({
  line,
}: {
  line: DiffLine;
}): ReactNode {
  const parts = line.kind === "add" ? line.newParts : line.oldParts;
  const sign = line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";
  const kindClass =
    line.kind === "add"
      ? styles.diffAdd
      : line.kind === "del"
        ? styles.diffDel
        : styles.diffCtx;
  const markClass = line.kind === "add" ? styles.wordAdd : styles.wordDel;
  return (
    <div className={`${styles.diffLine} ${kindClass}`}>
      <span className={styles.sign}>{sign}</span>
      <span className={styles.txt}>
        {parts
          ? parts.map((part, i) =>
              part.changed ? (
                <span key={i} className={markClass}>
                  {part.text}
                </span>
              ) : (
                <span key={i}>{part.text}</span>
              ),
            )
          : line.text}
      </span>
    </div>
  );
});

/**
 * unified diff 渲染：同步解析 + 行内词级差异，没有任何运行时初始化。
 *
 * stream-diffs 那套每次挂载都要建 runtime、加载主题与语言，首次要一秒多，
 * 长代码块还要 tokenize；这里渲染一次就是纯 React 行，打开即出内容。
 */
export function DiffLines({
  text,
  fallback = null,
}: {
  text: string;
  fallback?: ReactNode;
}): ReactNode {
  const parsed = useMemo(() => parseUnifiedDiff(text), [text]);
  const hunks = useMemo(
    () =>
      parsed.hunks.map((hunk, index) => (
        <div key={index} className={styles.hunk}>
          {hunk.header ? (
            <div className={styles.hunkHead}>{hunk.header}</div>
          ) : null}
          {hunk.lines.map((line, lineIndex) => (
            <DiffLineRow key={lineIndex} line={line} />
          ))}
        </div>
      )),
    [parsed],
  );

  if (parsed.plain) return fallback;
  return <>{hunks}</>;
}

/** 没有 hunk 头的补丁（纯文本输出）需要调用方退回原始文本。 */
export function isPlainDiff(text: string): boolean {
  return parseUnifiedDiff(text).plain;
}

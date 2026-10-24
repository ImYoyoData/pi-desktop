import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CheckmarkCircleOutline,
  EllipseOutline,
} from "@renderer/components/icons/ionicons";
import FileChip from "@renderer/components/FileChip";
import {
  readPreviewText,
  type BashToolCard,
  type FileToolCard,
  type GenericToolCard,
  type ReadToolCard,
  type TodoToolCard,
  type ToolCard,
} from "@renderer/utils/tool-diff";
import {
  parseUnifiedDiff,
  type DiffLine,
} from "@renderer/utils/diff-blocks";
import {
  buildJsonTree,
  parseJsonPayload,
  type JsonTreeNode,
} from "@renderer/utils/json-tree";
import { highlightToSafeHtml } from "@renderer/utils/markdown";
import { languageFromPath } from "@renderer/utils/editor-lang";
import { formatDuration } from "@renderer/utils/format-duration";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./ToolBody.module.css";

type Props = {
  card: ToolCard;
  streaming?: boolean;
  onOpen?: (path: string) => void;
};

/** 工具结果按语义分型渲染：读取走文件视图，编辑走 diff，命令走终端，其余走 JSON 树。 */
export function ToolBody({ card, streaming, onOpen }: Props): ReactNode {
  switch (card.kind) {
    case "read":
      return <FileBody card={card} onOpen={onOpen} />;
    case "edit":
    case "write":
    case "other":
      return <DiffBody card={card} />;
    case "bash":
      return <TerminalBody card={card} streaming={streaming} />;
    case "todo":
      return <TodoBody card={card} />;
    case "generic":
      return <JsonBody card={card} />;
    default:
      return null;
  }
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.replace(/\r\n/g, "\n").split("\n").length;
}

function FileBody({
  card,
  onOpen,
}: {
  card: ReadToolCard;
  onOpen?: (path: string) => void;
}): ReactNode {
  const t = useI18n();
  const text = useMemo(() => readPreviewText(card.preview ?? ""), [card.preview]);
  const html = useMemo(() => highlightToSafeHtml(text, card.lang), [text, card.lang]);
  const lineCount = useMemo(() => countLines(text), [text]);
  const start = card.startLine ?? 1;
  const end = lineCount ? start + lineCount - 1 : start;
  const total = card.totalLines ?? lineCount;
  const range =
    total > lineCount ? t.toolBodyLineRange(start, end, total) : t.toolBodyLines(lineCount);
  const numbers = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => start + i),
    [lineCount, start],
  );

  return (
    <>
      <div className={styles.head}>
        {card.path ? <FileChip path={card.path} onOpen={onOpen} /> : null}
        <span className={styles.langBadge}>{card.lang}</span>
        <span className={styles.meta}>{range}</span>
        {card.durationMs ? (
          <span className={styles.meta}>{formatDuration(card.durationMs)}</span>
        ) : null}
      </div>
      <div className={styles.body}>
        {lineCount ? (
          <div className={styles.codeView}>
            <div className={styles.gutter} aria-hidden="true">
              {numbers.map((n) => (
                <span key={n}>{n}</span>
              ))}
            </div>
            <div className={styles.codeScroll}>
              <pre className={styles.code}>
                <code dangerouslySetInnerHTML={{ __html: html }} />
              </pre>
            </div>
          </div>
        ) : (
          <pre className={styles.plain}>{t.toolResultNoOutput}</pre>
        )}
      </div>
    </>
  );
}

function DiffLineRow({ line }: { line: DiffLine }): ReactNode {
  const parts = line.kind === "add" ? line.newParts : line.oldParts;
  const sign = line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";
  const kindClass =
    line.kind === "add" ? styles.diffAdd : line.kind === "del" ? styles.diffDel : styles.diffCtx;
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
}

function DiffBody({ card }: { card: FileToolCard }): ReactNode {
  const t = useI18n();
  const parsed = useMemo(() => parseUnifiedDiff(card.diff ?? ""), [card.diff]);
  const lang = card.path ? languageFromPath(card.path) : "plaintext";

  return (
    <>
      <div className={styles.head}>
        {card.path ? <span className={styles.path}>{card.path}</span> : null}
        {card.path ? <span className={styles.langBadge}>{lang}</span> : null}
        {card.stats ? (
          <span className={styles.stats}>
            <span className={styles.statAdd}>+{card.stats.additions}</span>
            <span className={styles.statDel}>−{card.stats.deletions}</span>
          </span>
        ) : null}
      </div>
      <div className={styles.body}>
        {parsed.plain ? (
          <pre className={styles.plain}>{card.diff ?? t.toolResultNoOutput}</pre>
        ) : (
          parsed.hunks.map((hunk, index) => (
            <div key={index} className={styles.hunk}>
              {hunk.header ? <div className={styles.hunkHead}>{hunk.header}</div> : null}
              {hunk.lines.map((line, lineIndex) => (
                <DiffLineRow key={lineIndex} line={line} />
              ))}
            </div>
          ))
        )}
      </div>
    </>
  );
}

/** 失败时 pi 会在输出尾部追加这句；退出码已经单独展示，这里剥掉。 */
function stripExitNotice(text: string): string {
  return text.replace(/\n\nCommand exited with code \d+\s*$/i, "").replace(/\s+$/, "");
}

function TerminalBody({
  card,
  streaming,
}: {
  card: BashToolCard;
  streaming?: boolean;
}): ReactNode {
  const t = useI18n();
  const output = useMemo(() => stripExitNotice(card.preview ?? ""), [card.preview]);
  const failed = card.exitCode != null && card.exitCode !== 0;
  const duration = card.durationMs ? formatDuration(card.durationMs) : null;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!streaming) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [output, streaming]);

  return (
    <>
      <div className={styles.head}>
        {card.exitCode != null ? (
          <span className={failed ? styles.exitFail : styles.exitOk}>
            {t.toolBodyExitCode(card.exitCode)}
          </span>
        ) : null}
        {card.wallTimeSeconds != null ? (
          <span className={styles.meta}>{card.wallTimeSeconds.toFixed(1)}s</span>
        ) : null}
        {duration && duration !== card.wallTimeSeconds?.toFixed(1) ? (
          <span className={styles.meta}>{duration}</span>
        ) : null}
        {card.truncated ? <span className={styles.meta}>{t.toolTruncated}</span> : null}
      </div>
      <div className={`${styles.term} ${failed ? styles.termFailed : ""}`}>
        <div className={styles.termScroll} ref={scrollRef}>
          {card.command ? (
            <div className={styles.termCmd}>
              <span className={styles.prompt}>$</span>
              <span className={styles.cmd}>{card.command}</span>
            </div>
          ) : null}
          {card.truncated ? (
            <div className={styles.termNotice}>
              <span>
                {t.toolBodyTruncatedRange(card.linesRead ?? 0, card.totalLines ?? 0)}
              </span>
              {card.fullOutputPath ? (
                <span className={styles.path}>{card.fullOutputPath}</span>
              ) : null}
            </div>
          ) : null}
          <pre className={styles.termOut}>{output || (streaming ? "" : t.toolResultNoOutput)}</pre>
        </div>
      </div>
    </>
  );
}

function TodoBody({ card }: { card: TodoToolCard }): ReactNode {
  return (
    <ul className={styles.todoList}>
      {card.items.map((item) => (
        <li key={item.id} className={`${styles.todoItem}${item.done ? ` ${styles.done}` : ""}`}>
          {item.done ? (
            <CheckmarkCircleOutline size={14} className={styles.todoMark} />
          ) : (
            <EllipseOutline size={14} className={styles.todoMark} />
          )}
          <span className={styles.todoText}>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

type JsonRow = {
  node: JsonTreeNode;
  guide: string;
  isLast: boolean;
};

function collectJsonRows(node: JsonTreeNode, guide: string, isLast: boolean, out: JsonRow[]): void {
  out.push({ node, guide: guide + (isLast ? "└─ " : "├─ "), isLast });
  const children = node.children;
  if (!children?.length) return;
  const childGuide = guide + (isLast ? "   " : "│  ");
  children.forEach((child, index) => {
    collectJsonRows(child, childGuide, index === children.length - 1, out);
  });
}

function jsonScalarClass(type: string): string {
  if (type === "string") return styles.jsonStr;
  if (type === "number") return styles.jsonNum;
  if (type === "boolean") return styles.jsonBool;
  return styles.jsonNull;
}

function jsonScalarText(value: string | number | boolean | null, type: string): string {
  if (type === "string") {
    const text = String(value);
    return `"${text.length > 120 ? `${text.slice(0, 119)}…` : text}"`;
  }
  return String(value);
}

function JsonTree({ tree }: { tree: JsonTreeNode }): ReactNode {
  const t = useI18n();
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const rows = useMemo(() => {
    const out: JsonRow[] = [];
    collectJsonRows(tree, "", true, out);
    return out;
  }, [tree]);
  const isContainer = (node: JsonTreeNode): boolean => node.children != null;
  const isOpen = (node: JsonTreeNode): boolean =>
    isContainer(node) && !closed.has(node.id) && node.depth < 3;

  function toggle(id: string): void {
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className={styles.jsonTree}>
      {rows.map(({ node, guide }) => {
        if (!isContainer(node)) {
          return (
            <div key={node.id} className={styles.jsonRow}>
              <span className={styles.jsonChev} />
              <span className={styles.jsonGuide}>{guide}</span>
              {node.key !== null ? (
                <span className={styles.jsonKey}>{node.key}</span>
              ) : null}
              <span className={styles.jsonPunct}>: </span>
              <span className={`${jsonScalarClass(node.type)} ${styles.jsonValue}`}>
                {jsonScalarText(node.value, node.type)}
              </span>
            </div>
          );
        }
        const open = isOpen(node);
        const label =
          node.type === "array" ? `[${node.children?.length ?? 0}]` : `{${node.children?.length ?? 0}}`;
        return (
          <button
            key={node.id}
            type="button"
            className={`${styles.jsonRow} ${open ? styles.jsonOpen : ""}`}
            onClick={() => toggle(node.id)}
          >
            <span className={styles.jsonChev}>›</span>
            <span className={styles.jsonGuide}>{guide}</span>
            {node.key !== null ? (
              <span className={styles.jsonKey}>{node.key}</span>
            ) : null}
            <span className={styles.jsonPunct}>: </span>
            <span className={styles.jsonType}>{label}</span>
            {node.truncated ? (
              <span className={styles.jsonTruncated}>{t.toolBodyJsonTruncated}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function JsonBody({ card }: { card: GenericToolCard }): ReactNode {
  const t = useI18n();
  const data = useMemo(() => {
    if (card.structured != null) return card.structured;
    return parseJsonPayload(card.preview ?? "");
  }, [card.structured, card.preview]);
  const tree = useMemo(() => {
    if (data == null || typeof data !== "object") return null;
    return buildJsonTree(data);
  }, [data]);

  return (
    <>
      {data != null ? (
        <div className={styles.head}>
          <span className={styles.langBadge}>json</span>
          <span className={styles.meta}>{t.toolBodyStructured}</span>
        </div>
      ) : null}
      <div className={styles.body}>
        {tree ? (
          <JsonTree tree={tree} />
        ) : (
          <pre className={styles.plain}>{card.preview ?? t.toolResultNoOutput}</pre>
        )}
      </div>
    </>
  );
}

export default ToolBody;

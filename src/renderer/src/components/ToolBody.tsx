import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { DiffLines } from "@renderer/components/DiffLines";
import {
  CheckmarkCircleOutline,
  EllipseOutline,
  FolderOutline,
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
  buildJsonTree,
  defaultClosedNodeIds,
  parseJsonPayload,
  type JsonTreeNode,
} from "@renderer/utils/json-tree";
import {
  parseScriptReport,
  pathListFromOutput,
  type ScriptReport,
  type StructuredBlock,
} from "@renderer/utils/structured-text";
import { highlightToSafeHtml } from "@renderer/utils/markdown";
import { languageFromPath } from "@renderer/utils/editor-lang";
import { fileIcon } from "@renderer/utils/file-icon";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./ToolBody.module.css";

type Props = {
  card: ToolCard;
  streaming?: boolean;
  /** 工具名：generic 结果要靠它判断是不是路径清单类工具。 */
  toolName: string;
  /** 失败输出不按路径清单解释，避免把报错信息拆成条目。 */
  isError?: boolean;
  onOpen?: (path: string) => void;
};

/** 工具结果按语义分型渲染：读取走文件视图，编辑走 diff，命令走终端，其余走 JSON 树。 */
export function ToolBody({
  card,
  streaming,
  toolName,
  isError,
  onOpen,
}: Props): ReactNode {
  switch (card.kind) {
    case "read":
      return <FileBody card={card} onOpen={onOpen} />;
    case "edit":
    case "write":
    case "other":
      return <DiffBody card={card} />;
    case "bash":
      return (
        <TerminalBody
          card={card}
          streaming={streaming}
          isError={isError}
          toolName={toolName}
        />
      );
    case "todo":
      return <TodoBody card={card} />;
    case "generic":
      return (
        <JsonBody
          card={card}
          streaming={streaming}
          toolName={toolName}
          isError={isError}
        />
      );
    default:
      return null;
  }
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.replace(/\r\n/g, "\n").split("\n").length;
}

/** 代码块：行号 gutter + 语法高亮。文件视图与脚本报告里的代码小节共用。 */
function CodePreview({
  code,
  lang,
  startLine = 1,
}: {
  code: string;
  lang: string;
  startLine?: number;
}): ReactNode {
  const html = useMemo(() => highlightToSafeHtml(code, lang), [code, lang]);
  const lineCount = useMemo(() => countLines(code), [code]);
  const numbers = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => startLine + i),
    [lineCount, startLine],
  );
  return (
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
  );
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
  const lineCount = useMemo(() => countLines(text), [text]);
  const start = card.startLine ?? 1;
  const end = lineCount ? start + lineCount - 1 : start;
  const total = card.totalLines ?? lineCount;
  const range =
    total > lineCount ? t.toolBodyLineRange(start, end, total) : t.toolBodyLines(lineCount);

  return (
    <>
      <div className={styles.head}>
        {card.path ? <FileChip path={card.path} onOpen={onOpen} /> : null}
        <span className={styles.langBadge}>{card.lang}</span>
        <span className={styles.meta}>{range}</span>
      </div>
      <div className={styles.body} data-inner-scroll="">
        {lineCount ? (
          <CodePreview code={text} lang={card.lang} startLine={start} />
        ) : (
          <pre className={styles.plain}>{t.toolResultNoOutput}</pre>
        )}
      </div>
    </>
  );
}

function DiffBody({ card }: { card: FileToolCard }): ReactNode {
  const t = useI18n();
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
      <div className={styles.body} data-inner-scroll="">
        <DiffLines
          text={card.diff ?? ""}
          fallback={
            // 空字符串也是「没有补丁」，`??` 接不住空串。
            <pre className={styles.plain}>
              {card.diff?.trim() ? card.diff : t.toolResultNoOutput}
            </pre>
          }
        />
      </div>
    </>
  );
}

/** 去掉输出首尾的空白行，以及 pi 追加在尾部的 "Command exited with code N"（退出码已单独展示）。 */
function stripExitNotice(text: string): string {
  return text
    .replace(/\n\nCommand exited with code \d+\s*$/i, "")
    .replace(/^[\r\n]+/, "")
    .replace(/\s+$/, "");
}

function TerminalBody({
  card,
  streaming,
  isError,
  toolName,
}: {
  card: BashToolCard;
  streaming?: boolean;
  isError?: boolean;
  toolName?: string;
}): ReactNode {
  const t = useI18n();
  const output = useMemo(() => stripExitNotice(card.preview ?? ""), [card.preview]);
  const failed = Boolean(isError) || (card.exitCode != null && card.exitCode !== 0);
  /** PowerShell 用 PS> 提示符，否则命令本身以 $ 开头时会显示成 "$ $p = …"。 */
  const promptLabel = /^(powershell|pwsh)$/iu.test(toolName ?? "") ? "PS>" : "$";
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!streaming) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [output, streaming]);

  return (
    <>
      {card.exitCode != null || card.truncated ? (
        <div className={styles.head}>
          {card.exitCode != null ? (
            <span className={failed ? styles.exitFail : styles.exitOk}>
              {t.toolBodyExitCode(card.exitCode)}
            </span>
          ) : null}
          {card.truncated ? <span className={styles.meta}>{t.toolTruncated}</span> : null}
        </div>
      ) : null}
      <div className={`${styles.term} ${failed ? styles.termFailed : ""}`}>
        <div className={styles.termScroll} ref={scrollRef} data-inner-scroll="">
          {card.command ? (
            <div className={styles.termCmd}>
              <span className={styles.prompt}>{promptLabel}</span>
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

/** 树节点：容器可折叠，标量直接显示。 */
function JsonNodeRow({
  node,
  closed,
  onToggle,
  guide,
  isLast,
}: {
  node: JsonTreeNode;
  closed: Set<string>;
  onToggle: (id: string) => void;
  guide: string;
  isLast: boolean;
}): ReactNode {
  const t = useI18n();
  const isContainer = node.children != null;
  const open = isContainer && !closed.has(node.id);
  const rowGuide = guide + (isLast ? "└─ " : "├─ ");
  const childGuide = guide + (isLast ? "   " : "│  ");

  if (!isContainer) {
    return (
      <div className={styles.jsonRow}>
        <span className={styles.jsonChev} />
        <span className={styles.jsonGuide}>{rowGuide}</span>
        {node.key !== null ? <span className={styles.jsonKey}>{node.key}</span> : null}
        <span className={styles.jsonPunct}>: </span>
        <span className={`${jsonScalarClass(node.type)} ${styles.jsonValue}`}>
          {jsonScalarText(node.value, node.type)}
        </span>
      </div>
    );
  }

  const label =
    node.type === "array" ? `[${node.children?.length ?? 0}]` : `{${node.children?.length ?? 0}}`;
  return (
    <>
      <button
        type="button"
        className={`${styles.jsonRow} ${open ? styles.jsonOpen : ""}`}
        aria-expanded={open}
        onClick={() => onToggle(node.id)}
      >
        <span className={styles.jsonChev}>›</span>
        <span className={styles.jsonGuide}>{rowGuide}</span>
        {node.key !== null ? <span className={styles.jsonKey}>{node.key}</span> : null}
        <span className={styles.jsonPunct}>: </span>
        <span className={styles.jsonType}>{label}</span>
        {node.truncated ? (
          <span className={styles.jsonTruncated}>{t.toolBodyJsonTruncated}</span>
        ) : null}
      </button>
      {open && node.children?.length
        ? node.children.map((child, index) => (
            <JsonNodeRow
              key={child.id}
              node={child}
              closed={closed}
              onToggle={onToggle}
              guide={childGuide}
              isLast={index === node.children!.length - 1}
            />
          ))
        : null}
    </>
  );
}

function JsonTree({ tree }: { tree: JsonTreeNode }): ReactNode {
  const [closed, setClosed] = useState<Set<string>>(() => defaultClosedNodeIds(tree));

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
      <JsonNodeRow node={tree} closed={closed} onToggle={toggle} guide="" isLast />
    </div>
  );
}

/** 路径清单条目：ls / find 的结果，带文件图标与目录标记。 */
function PathList({ entries }: { entries: string[] }): ReactNode {
  return (
    <ul className={styles.pathList}>
      {entries.map((entry, index) => {
        const isDir = entry.endsWith("/");
        const icon = isDir ? null : fileIcon(entry);
        return (
          <li
            key={`${index}-${entry}`}
            className={`${styles.pathItem}${isDir ? ` ${styles.pathDir}` : ""}`}
          >
            {isDir ? (
              <FolderOutline
                size={13}
                className={styles.pathIcon}
                aria-hidden="true"
              />
            ) : (
              <span
                className={styles.pathIcon}
                style={icon?.color ? { color: icon.color } : undefined}
                aria-hidden="true"
              >
                {icon?.glyph}
              </span>
            )}
            <span className={styles.pathName}>{entry}</span>
          </li>
        );
      })}
    </ul>
  );
}

function PathListBody({ entries }: { entries: string[] }): ReactNode {
  const t = useI18n();
  return (
    <>
      <div className={styles.head}>
        <span className={styles.langBadge}>{t.toolBodyPathList}</span>
        <span className={styles.meta}>{t.toolBodyPathCount(entries.length)}</span>
      </div>
      <div className={styles.body} data-inner-scroll="">
        <PathList entries={entries} />
      </div>
    </>
  );
}

function ScriptBlock({ block }: { block: StructuredBlock }): ReactNode {
  if (block.kind === "code") {
    // 小节标题未必是路径（脚本可能打印成 ===== <json> =====），不是路径就不挂语言徽章。
    const looksLikePath = !/[\s{}"']/.test(block.path);
    const lang = looksLikePath ? languageFromPath(block.path) : "plaintext";
    return (
      <div className={styles.scriptCode}>
        <div className={styles.scriptCodeHead}>
          <span className={styles.scriptCodePath}>{block.path}</span>
          {looksLikePath ? <span className={styles.langBadge}>{lang}</span> : null}
        </div>
        <CodePreview code={block.code} lang={lang} />
      </div>
    );
  }
  if (block.kind === "console") {
    return (
      <div className={styles.scriptConsole}>
        {block.lines.map((line, index) => (
          <div key={index} className={styles.scriptConsoleLine}>
            {line}
          </div>
        ))}
      </div>
    );
  }
  return <pre className={styles.plain}>{block.text}</pre>;
}

/** codemode 的脚本报告：状态 + 耗时 + 小节（代码小节带语法高亮）。 */
function ScriptReportBody({ report }: { report: ScriptReport }): ReactNode {
  const t = useI18n();
  return (
    <>
      <div className={styles.head}>
        <span className={report.status === "completed" ? styles.exitOk : styles.exitFail}>
          {report.status === "completed" ? t.toolBodyScriptCompleted : t.toolBodyScriptFailed}
        </span>
        {report.wallTime != null ? (
          <span className={styles.meta}>{t.toolBodyWallTime(report.wallTime)}</span>
        ) : null}
        <span className={styles.meta}>{t.toolBodyScriptSections(report.sections.length)}</span>
      </div>
      <div className={styles.body} data-inner-scroll="">
        {report.sections.map((section, index) => (
          <section key={index} className={styles.scriptSection}>
            {section.title ? (
              <div className={styles.scriptSectionTitle}>{section.title}</div>
            ) : null}
            {section.blocks.map((block, blockIndex) => (
              <ScriptBlock key={blockIndex} block={block} />
            ))}
          </section>
        ))}
        {report.error ? <div className={styles.scriptError}>{report.error}</div> : null}
      </div>
    </>
  );
}

/** JSON 树：既用于 generic 工具结果，也用于嵌套调用的参数。 */
export function ToolJsonTree({ value }: { value: unknown }): ReactNode {
  const tree = useMemo(() => {
    if (value == null || typeof value !== "object") return null;
    return buildJsonTree(value);
  }, [value]);
  if (tree) return <JsonTree tree={tree} />;
  if (value == null) return null;
  return (
    <pre className={styles.plain}>
      {typeof value === "string" ? value : String(value)}
    </pre>
  );
}

function JsonBody({
  card,
  streaming,
  toolName,
  isError,
}: {
  card: GenericToolCard;
  streaming?: boolean;
  toolName: string;
  isError?: boolean;
}): ReactNode {
  const t = useI18n();
  /**
   * 流式期间不尝试解析 JSON：结果是一段段追加的文本，
   * 某一刻能 parse、下一刻又不能，树会闪一下再消失。
   * 等结果落地再一次性解析成树。
   */
  const data = useMemo(() => {
    if (card.structured != null) return card.structured;
    if (streaming || card.previewFromArgs) return null;
    return parseJsonPayload(card.preview ?? "");
  }, [card.previewFromArgs, card.structured, card.preview, streaming]);
  const tree = useMemo(() => {
    if (data == null || typeof data !== "object") return null;
    return buildJsonTree(data);
  }, [data]);
  const text = card.preview ?? "";

  /**
   * 结构化文本：codemode 的脚本报告与路径清单都有固定形态，
   * 直接当纯文本糊出来会丢掉小节标题与代码高亮。
   */
  const report = useMemo(() => {
    if (tree || streaming) return null;
    return parseScriptReport(text);
  }, [tree, streaming, text]);
  const paths = useMemo(() => {
    if (tree || report || streaming || isError || card.previewFromArgs) return null;
    return pathListFromOutput(text, toolName);
  }, [card.previewFromArgs, isError, report, streaming, text, toolName, tree]);

  if (tree) {
    return (
      <>
        <div className={styles.head}>
          <span className={styles.langBadge}>json</span>
          <span className={styles.meta}>{t.toolBodyStructured}</span>
        </div>
        <div className={styles.body} data-inner-scroll="">
          <JsonTree tree={tree} />
        </div>
      </>
    );
  }
  if (report) {
    return <ScriptReportBody report={report} />;
  }
  if (paths && paths.length) {
    return <PathListBody entries={paths} />;
  }
  return (
    <div className={styles.body} data-inner-scroll="">
      <pre className={styles.plain}>
        {card.preview?.trim() ? card.preview : t.toolResultNoOutput}
      </pre>
    </div>
  );
}

export default ToolBody;

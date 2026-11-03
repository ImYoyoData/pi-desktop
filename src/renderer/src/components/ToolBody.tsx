import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ToolDiffView } from "@renderer/components/ToolDiffView";
import {
  CheckmarkCircleOutline,
  CloseOutline,
  EllipseOutline,
  FolderOutline,
  SyncOutline,
} from "@renderer/components/icons/ionicons";
import FileChip from "@renderer/components/FileChip";
import {
  readPreviewText,
  clipText,
  type BashToolCard,
  type FileToolCard,
  type GenericToolCard,
  type GrepToolCard,
  type ReadToolCard,
  type TodoToolCard,
  type ToolCard,
  type WaitJob,
  type WaitToolCard,
} from "@renderer/utils/tool-diff";
import { formatTokenCount } from "@renderer/utils/agent-wait";
import { sortWaitJobs, waitElapsedMs, waitJobCounts } from "@renderer/utils/tool-wait";
import { formatDuration } from "@renderer/utils/format-duration";
import { useNow } from "@renderer/utils/use-now";
import WaitJobWidget from "@renderer/components/WaitJobWidget";
import SubagentTranscript from "@renderer/components/SubagentTranscript";
import { grepOpenPath, type GrepLine } from "@renderer/utils/grep-card";
import {
  browserResultHead,
  mcpServerName,
  toolCountLabel,
  toolFamily,
  toolResultCount,
} from "@renderer/utils/tool-family";

import {
  buildJsonTree,
  defaultClosedNodeIds,
  parseJsonPayload,
  type JsonTreeNode,
} from "@renderer/utils/json-tree";
import {
  parseScriptReport,
  pathListFromOutput,
  splitTrailingNotice,
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

/** 工具结果按语义分型渲染：读取走文件视图，编辑走 diff，命令走终端，其余走 JSON 树。
   整体包一层描边卡片：头部条与正文连成一块，不再散在聊天背景上。 */
export function ToolBody(props: Props): ReactNode {
  const content = renderToolBody(props);
  if (!content) return null;
  return <div className={styles.view}>{content}</div>;
}

function renderToolBody({
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
    case "grep":
      return <GrepBody card={card} onOpen={onOpen} />;
    case "todo":
      return <TodoBody card={card} />;
    case "wait":
      return <WaitBody card={card} streaming={streaming} />;
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
        <ToolDiffView
          text={card.diff ?? ""}
          path={card.path}
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

/** grep 命中行：左行号 + 语法高亮，点整行打开所在文件。 */
function GrepLineRow({
  row,
  lang,
  onOpen,
}: {
  row: GrepLine;
  lang: string;
  onOpen?: () => void;
}): ReactNode {
  const html = useMemo(() => highlightToSafeHtml(row.text, lang), [row.text, lang]);
  if (row.gap) {
    return (
      <div className={`${styles.grepLine} ${styles.grepGap}`}>
        <span className={styles.grepLineNo} />
        <span className={styles.grepLineText}>…</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`${styles.grepLine}${row.match ? ` ${styles.grepHit}` : ""}`}
      onClick={onOpen}
    >
      <span className={styles.grepLineNo}>{row.line}</span>
      <span className={styles.grepLineText} dangerouslySetInnerHTML={{ __html: html }} />
    </button>
  );
}

function GrepBody({
  card,
  onOpen,
}: {
  card: GrepToolCard;
  onOpen?: (path: string) => void;
}): ReactNode {
  const t = useI18n();
  const summary = card.matchCount
    ? t.toolBodyGrepMatches(card.matchCount, card.hits.length)
    : card.noMatches
      ? t.toolBodyGrepNoMatches
      : null;

  return (
    <>
      <div className={styles.head}>
        <span className={styles.langBadge}>grep</span>
        {card.ignoreCase ? <span className={styles.meta}>{t.toolBodyGrepIgnoreCase}</span> : null}
        {card.literal ? <span className={styles.meta}>{t.toolBodyGrepLiteral}</span> : null}
        {card.glob ? <span className={styles.langBadge}>{card.glob}</span> : null}
        {card.searchPath ? <span className={styles.path}>{card.searchPath}</span> : null}
        {summary ? <span className={styles.meta}>{summary}</span> : null}
      </div>
      <div className={styles.body} data-inner-scroll="">
        {card.hits.length ? (
          <div className={styles.grepFiles}>
            {card.hits.map((group) => {
              const path = grepOpenPath(card.searchPath, group.path, group.pathBase);
              const lang = languageFromPath(group.path);
              return (
                <div key={path} className={styles.grepFile}>
                  <div className={styles.grepFileHead}>
                    <FileChip path={path} label={group.path} onOpen={onOpen} />
                    <span className={styles.langBadge}>{lang}</span>
                    <span className={styles.meta}>
                      {t.toolBodyGrepFileHits(group.lines.filter((row) => row.match).length)}
                    </span>
                  </div>
                  {group.lines.map((row, index) => (
                    <GrepLineRow
                      key={`${row.line}-${index}`}
                      row={row}
                      lang={lang}
                      onOpen={onOpen ? () => onOpen(path) : undefined}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          <pre className={styles.plain}>{card.preview ?? t.toolResultNoOutput}</pre>
        )}
      </div>
      {card.notices.length ? (
        <div className={styles.notice}>
          <span className={styles.meta}>{t.toolTruncated}</span>
          {card.notices.map((notice, index) => (
            <span key={index}>{notice}</span>
          ))}
        </div>
      ) : null}
    </>
  );
}

function TodoBody({ card }: { card: TodoToolCard }): ReactNode {
  const t = useI18n();
  if (!card.items.length) {
    return <p className={styles.todoEmpty}>{t.toolTodoEmpty}</p>;
  }
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

/** wait 的运行中计时：只在流式期间每秒重渲染，任务耗时仍以 500ms 快照为准。 */
function firstOutputLine(text: string): string {
  return (
    text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? ""
  );
}

function WaitJobRow({
  job,
  now,
  streaming,
  observedAt,
}: {
  job: WaitJob;
  now: number;
  streaming: boolean;
  observedAt: number | null;
}): ReactNode {
  const t = useI18n();
  const running = job.status === "running";
  const failed = job.status === "failed";
  const Icon = running
    ? SyncOutline
    : failed
      ? CloseOutline
      : job.status === "completed"
        ? CheckmarkCircleOutline
        : EllipseOutline;
  const iconClass = [
    styles.waitJobIcon,
    running ? styles.waitJobIconRunning : "",
    failed ? styles.waitJobIconFailed : "",
    job.status === "completed" ? styles.waitJobIconDone : "",
  ]
    .filter(Boolean)
    .join(" ");

  const meta: string[] = [];
  if (job.requests != null && job.requests > 0) {
    meta.push(t.toolWaitRequests(job.requests));
  }
  if (job.cost != null && job.cost > 0) {
    meta.push(t.toolWaitCost(job.cost < 0.005 ? "<0.01" : job.cost.toFixed(2)));
  }
  if (job.contextTokens != null && job.contextTokens > 0) {
    meta.push(
      t.toolWaitContext(
        formatTokenCount(job.contextTokens),
        job.contextWindow ? formatTokenCount(job.contextWindow) : null,
      ),
    );
  }
  if (job.exitCode != null && job.exitCode !== 0) {
    meta.push(t.toolBodyExitCode(job.exitCode));
  }

  const percent =
    running && job.completionPercent != null
      ? Math.max(0, Math.min(100, Math.round(job.completionPercent)))
      : null;
  const outcome = failed ? job.errorText : job.resultText;
  const activity = job.widget?.stage ?? job.stage;
  const widget =
    job.widget && (job.widget.headline || job.widget.blocks.length)
      ? job.widget
      : null;
  const jobDurationMs =
    streaming && observedAt != null
      ? job.durationMs + Math.max(0, now - observedAt)
      : job.durationMs;

  return (
    <li className={styles.waitJob}>
      <div className={styles.waitJobHead}>
        <Icon size={13} className={iconClass} aria-hidden="true" />
        <span className={styles.waitJobType}>{job.type}</span>
        <span className={styles.waitJobLabel} title={job.label}>
          {job.intent || job.label}
        </span>
        {percent != null ? <span className={styles.waitJobPercent}>{percent}%</span> : null}
        <span className={styles.waitJobTime}>{formatDuration(jobDurationMs)}</span>
      </div>
      {percent != null ? (
        <div className={styles.waitMeter}>
          <span className={styles.waitMeterFill} style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      {activity ? (
        <div className={styles.waitJobActivity} title={activity}>
          {activity}
        </div>
      ) : null}
      {widget ? <WaitJobWidget widget={widget} activity={activity} /> : null}
      {meta.length ? <div className={styles.waitJobMeta}>{meta.join(" · ")}</div> : null}
      {!running && outcome ? (
        <div className={failed ? styles.waitJobError : styles.waitJobResult}>
          {firstOutputLine(outcome)}
        </div>
      ) : null}
      {job.type === "task" && job.agentId ? (
        <SubagentTranscript agentId={job.agentId} active={running} />
      ) : null}
    </li>
  );
}

/** wait 的进度全在 details.jobs：等待哪些任务、各自的完成度与阶段。 */
function WaitBody({
  card,
  streaming,
}: {
  card: WaitToolCard;
  streaming?: boolean;
}): ReactNode {
  const t = useI18n();
  const counts = waitJobCounts(card.jobs);
  const now = useNow(
    Boolean(streaming) && (card.jobs.length > 0 || card.startedAt != null),
  );
  const elapsed = waitElapsedMs(
    card.startedAt,
    card.durationMs,
    Boolean(streaming),
    now,
  );
  const jobs = useMemo(() => sortWaitJobs(card.jobs), [card.jobs]);

  return (
    <>
      <div className={styles.head}>
        <span className={styles.langBadge}>wait</span>
        {card.jobs.length ? (
          <span className={styles.meta}>{t.toolWaitJobs(card.jobs.length)}</span>
        ) : null}
        {counts.running ? (
          <span className={styles.waitCountRunning}>
            {t.toolWaitRunningCount(counts.running)}
          </span>
        ) : null}
        {counts.completed ? (
          <span className={styles.waitCountDone}>
            {t.toolWaitDoneCount(counts.completed)}
          </span>
        ) : null}
        {counts.failed ? (
          <span className={styles.waitCountFailed}>
            {t.toolWaitFailedCount(counts.failed)}
          </span>
        ) : null}
        {counts.cancelled ? (
          <span className={styles.waitCountCancelled}>
            {t.toolWaitCancelledCount(counts.cancelled)}
          </span>
        ) : null}
        {elapsed != null ? (
          <span className={styles.waitElapsed}>
            {t.toolWaitElapsed(formatDuration(elapsed))}
          </span>
        ) : null}
      </div>
      <div className={styles.body} data-inner-scroll="">
        {jobs.length ? (
          <ul className={styles.waitJobs}>
            {jobs.map((job) => (
              <WaitJobRow
                key={job.id}
                job={job}
                now={now}
                streaming={Boolean(streaming)}
                observedAt={card.observedAt}
              />
            ))}
          </ul>
        ) : (
          <p className={styles.plain}>
            {streaming ? t.toolWaitPending : (card.text ?? t.toolWaitEmpty)}
          </p>
        )}
        {jobs.length && card.text ? (
          <div className={styles.waitText}>
            <div className={styles.waitTextHead}>{t.toolWaitResult}</div>
            <pre className={styles.plain}>{card.text}</pre>
          </div>
        ) : null}
      </div>
    </>
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

function PathListBody({
  entries,
  notices,
}: {
  entries: string[];
  notices: string[];
}): ReactNode {
  const t = useI18n();
  return (
    <>
      <div className={styles.head}>
        <span className={styles.langBadge}>{t.toolBodyPathList}</span>
        <span className={styles.meta}>{t.toolBodyPathCount(entries.length)}</span>
        {notices.length ? <span className={styles.meta}>{t.toolTruncated}</span> : null}
      </div>
      <div className={styles.body} data-inner-scroll="">
        <PathList entries={entries} />
      </div>
      {notices.length ? (
        <div className={styles.notice}>
          {notices.map((notice, index) => (
            <span key={index}>{notice}</span>
          ))}
        </div>
      ) : null}
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

  const family = toolFamily(toolName);
  /** 量级摘要：清单条目 / 浏览器元素 / 搜索到的工具。 */
  const count = useMemo(
    () => (streaming ? null : toolResultCount(toolName, text, card.structured)),
    [card.structured, streaming, text, toolName],
  );

  if (tree) {
    /** browser_* 返回 { url, title, elements }：要说清 snapshot 的是哪一页。 */
    const browserHead = family === "browser" ? browserResultHead(data) : null;
    const badge = family === "browser" ? "browser" : (mcpServerName(toolName) ?? "json");
    return (
      <>
        <div className={styles.head}>
          <span className={styles.langBadge}>{badge}</span>
          {browserHead?.url ? <span className={styles.path}>{browserHead.url}</span> : null}
          <span className={styles.meta}>
            {count ? toolCountLabel(t, count) : t.toolBodyStructured}
          </span>
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
    return (
      <PathListBody
        entries={paths}
        notices={splitTrailingNotice(text).notices}
      />
    );
  }
  return (
    <>
      <div className={styles.head}>
        <span className={styles.langBadge}>{clipText(toolName, 32)}</span>
        {count ? <span className={styles.meta}>{toolCountLabel(t, count)}</span> : null}
      </div>
      <div className={styles.body} data-inner-scroll="">
        <pre className={styles.plain}>
          {card.preview?.trim() ? card.preview : t.toolResultNoOutput}
        </pre>
      </div>
    </>
  );
}

export default ToolBody;

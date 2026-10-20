import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { Button } from "antd";
import {
  CheckmarkCircleOutline,
  ChevronForwardOutline,
  CloseCircleOutline,
  CreateOutline,
  DocumentTextOutline,
  EllipseOutline,
  EyeOutline,
  ListOutline,
  TerminalOutline,
  type IoniconProps,
} from "@renderer/components/icons/ionicons";
import type { ToolCard } from "@renderer/utils/tool-diff";
import { previewText } from "@renderer/utils/tool-diff";
import type { ChatToolNestedCall } from "@renderer/stores/chat-reducer";
import { isToolCardOpen } from "@renderer/utils/tool-card-open";
import FileChip from "@renderer/components/FileChip";
import { useI18n } from "@renderer/i18n/use-i18n";
import { formatElapsedShort } from "@renderer/utils/agent-wait";
import { useAgentRunsStore } from "@renderer/stores/agent-runs";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useMessage } from "@renderer/services/feedback";
import { ASK_USER_TOOL_NAME } from "../../../shared/ask-user";
import styles from "./ToolCallCard.module.css";

type Props = {
  card: ToolCard;
  toolName: string;
  order?: number;
  statusLabel: string;
  statusType: "default" | "success" | "error" | "info";
  streaming?: boolean;
  /** True once the whole turn finished: fold finished process rows (Codex-like). */
  autoCollapse?: boolean;
  /** Rendered as a child of a Copilot tool group: indented under the tree line. */
  treeItem?: boolean;
  /**
   * Never auto-expand while streaming — the row stays folded until the user opens
   * it. Used for the detail rows inside a work-section, whose group header already
   * summarises what happened ("已读取 2 个文件 · 已运行 1 条命令"), so expanding
   * every row as well only buries the answer.
   */
  detailCollapsed?: boolean;
  /** 工具内部调用（ctx.executeTool，如 codemode 脚本）的嵌套调用。 */
  nestedCalls?: ChatToolNestedCall[];
  onOpen: (path: string) => void;
};

type KindIconComponent = ComponentType<IoniconProps>;

function kindIconFor(kind: ToolCard["kind"]): KindIconComponent {
  switch (kind) {
    case "read":
      return EyeOutline;
    case "write":
    case "edit":
      return CreateOutline;
    case "bash":
      return TerminalOutline;
    case "todo":
      return ListOutline;
    case "generic":
    case "other":
      return DocumentTextOutline;
    default:
      return DocumentTextOutline;
  }
}

/** Sub-second precision for quick commands, coarse units beyond that. */
function formatDuration(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return formatElapsedShort(ms);
}

export function ToolCallCard({
  card,
  toolName,
  statusType,
  streaming,
  autoCollapse,
  treeItem,
  detailCollapsed,
  nestedCalls,
  onOpen,
}: Props): ReactNode {
  const t = useI18n();
  const message = useMessage();
  const appearance = useAppearanceStore();
  const agentRuns = useAgentRunsStore();
  const sessions = useSessionsStore();

  /** Explicit user toggle; null = follow the automatic rule. */
  const [manuallyOpen, setManuallyOpen] = useState<boolean | null>(null);
  const bodyRef = useRef<HTMLPreElement | null>(null);
  /** Follow newest lines unless the user scrolls up inside the card. */
  const stickToBottom = useRef(true);
  const NEAR_BOTTOM_PX = 48;
  const [backgroundBusy, setBackgroundBusy] = useState(false);

  /**
   * Whether a tool card opens by itself. The rule lives in
   * `utils/tool-card-open.ts` (pure + unit-tested); this component only supplies
   * state. Default is folded for every kind — a long turn can hold dozens of cards,
   * and auto-expanding them buries the answer under diffs and file dumps.
   */
  const open = isToolCardOpen({
    kind: card.kind,
    expandToolCalls: appearance.expandToolCalls,
    detailCollapsed: Boolean(detailCollapsed),
    autoCollapse: Boolean(autoCollapse),
    streaming: Boolean(streaming),
    manuallyOpen,
  });

  useEffect(() => {
    if (!streaming) return;
    // Reset manual override while streaming so it tracks live state.
    setManuallyOpen(null);
    stickToBottom.current = true;
  }, [streaming]);

  // Fold everything as soon as the round finishes; users can re-expand manually.
  useEffect(() => {
    if (!autoCollapse) return;
    setManuallyOpen(false);
  }, [autoCollapse]);

  const isAskUserTool = toolName === ASK_USER_TOOL_NAME;
  const sessionId = sessions.activeId;

  const blockingRunId = useMemo(() => {
    const current = card;
    if (current.kind !== "bash" || !streaming) return null;
    const command = current.command?.trim();
    if (!sessionId || !command) return null;
    return agentRuns.findBlockingRun(sessionId, command)?.id ?? null;
  }, [agentRuns, card, sessionId, streaming]);

  const canBackground = Boolean(blockingRunId);

  async function onBackground(): Promise<void> {
    const runId = blockingRunId;
    if (!runId || backgroundBusy) return;
    setBackgroundBusy(true);
    try {
      await agentRuns.background(runId);
      message.success(t.toolBackgrounded);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t.toolBackgroundFailed);
    } finally {
      setBackgroundBusy(false);
    }
  }

  const fileName = useMemo(() => {
    const current = card;
    if (current.kind === "bash" || current.kind === "generic" || current.kind === "todo") {
      return null;
    }
    const p = current.path;
    if (!p) return null;
    const parts = p.split(/[/\\]/);
    return parts[parts.length - 1] || p;
  }, [card]);

  const actionLabel = useMemo(() => {
    switch (card.kind) {
      case "write":
        return t.toolWrite;
      case "edit":
        return t.toolEdit;
      case "read":
        return t.toolRead;
      case "bash":
        return t.toolBash;
      case "todo":
        return t.toolTodo;
      case "generic":
        return isAskUserTool ? t.askUserToolLabel : `${t.toolBash} ${toolName}`;
      case "other":
        return isAskUserTool ? t.askUserToolLabel : `${t.toolBash} ${toolName}`;
      default: {
        const _never: never = card;
        return String(_never);
      }
    }
  }, [card, isAskUserTool, t, toolName]);

  const KindIcon = kindIconFor(card.kind);
  const StatusIcon = statusType === "error" ? CloseCircleOutline : KindIcon;

  const metaLine = useMemo(() => {
    const dur =
      (card.kind === "read" || card.kind === "bash") &&
      card.durationMs != null &&
      card.durationMs > 0
        ? formatDuration(card.durationMs)
        : null;
    const appendDuration = (base: string | null): string | null => {
      if (!base) return dur ? t.toolDuration(dur) : null;
      return dur ? `${base} · ${dur}` : base;
    };
    if (card.kind === "read") {
      if (card.linesRead != null && card.totalLines != null) {
        return t.toolLinesRange(card.linesRead, card.totalLines);
      }
      if (card.linesRead != null) {
        return t.toolLinesCount(card.linesRead);
      }
      return null;
    }
    if (card.kind === "bash") {
      if (card.linesRead != null && card.totalLines != null) {
        return appendDuration(t.toolLinesRange(card.linesRead, card.totalLines));
      }
      if (card.linesRead != null) {
        return appendDuration(t.toolLinesCount(card.linesRead));
      }
      return appendDuration(null);
    }
    if (card.kind === "todo" && card.summary) return card.summary;
    return null;
  }, [card, t]);

  const headline = useMemo(() => {
    if (isAskUserTool) return "";
    if (card.kind === "bash") return card.command || toolName;
    if (card.kind === "generic") return card.summary || "";
    if (card.kind === "todo") {
      if (card.action === "add") return t.toolTodoAdd;
      if (card.action === "toggle") return t.toolTodoToggle;
      if (card.action === "clear") return t.toolTodoClear;
      if (card.action === "list") return t.toolTodoList;
      return card.items.length
        ? t.todoProgress(
            card.items.filter((i) => i.done).length,
            card.items.length,
          )
        : toolName;
    }
    return fileName || toolName;
  }, [card, fileName, isAskUserTool, t, toolName]);

  /** 按用户设定的截断行数渲染工具输出；0 表示不截断。 */
  function renderBodyText(text: string | null | undefined): string | null {
    if (!text) return null;
    const maxLines = appearance.truncateToolOutputLines;
    return maxLines > 0 ? previewText(text, maxLines) : text;
  }

  const body = useMemo(() => {
    if (card.kind === "todo") return null;
    if (card.kind === "bash") {
      const cmd = card.command?.trim() || "";
      const out = renderBodyText(card.preview);
      if (cmd && out) return `$ ${cmd}\n\n${out}`;
      if (out) return out;
      if (cmd) return `$ ${cmd}`;
      return null;
    }
    if (card.kind === "edit" || card.kind === "write") {
      return card.diff;
    }
    if (card.kind === "other") return renderBodyText(card.diff);
    return card.kind === "read" || card.kind === "generic"
      ? renderBodyText(card.preview)
      : null;
  }, [card, appearance.truncateToolOutputLines]);

  const stickKinds = card.kind === "write" || card.kind === "edit" || card.kind === "bash";

  useEffect(() => {
    if (!stickKinds) return;
    // Write/edit: always stick while open (args/result land progressively).
    // Bash: stick while streaming live output.
    if (card.kind === "bash" && !streaming) return;
    if (!open || !stickToBottom.current) return;
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [body, streaming, open, stickKinds, card.kind]);

  const cardImages = useMemo<string[]>(
    () => (card.kind === "generic" ? card.images : []),
    [card],
  );

  const emptyBodyText = useMemo(() => {
    if (card.kind === "bash") return t.toolNoOutput;
    if (card.kind === "todo") return t.toolTodoEmpty;
    if (card.kind === "read" || card.kind === "generic") return t.toolNoOutput;
    return t.toolNoDiff;
  }, [card.kind, t]);

  const isDiffBody = card.kind === "edit" || card.kind === "write";

  const pathTitle =
    card.kind === "bash" || card.kind === "generic" || card.kind === "todo"
      ? undefined
      : (card.path ?? undefined);

  const todoItems = useMemo(() => (card.kind === "todo" ? card.items : []), [card]);

  /** Rows with nothing to reveal drop the disclosure affordance (VS Code setExpandable). */
  const expandable =
    card.kind === "todo"
      ? todoItems.length > 0
      : Boolean(nestedCalls?.length) || Boolean(body) || cardImages.length > 0;

  /** 可预览的文件路径（read / edit / write / other 卡才有）。 */
  const previewPath = useMemo<string | null>(() => {
    if (
      card.kind === "read" ||
      card.kind === "edit" ||
      card.kind === "write" ||
      card.kind === "other"
    ) {
      return card.path ?? null;
    }
    return null;
  }, [card]);

  function toggleOpen(): void {
    const next = !open;
    setManuallyOpen(next);
    if (!next) return;
    stickToBottom.current = true;
  }

  function onBodyScroll(): void {
    const el = bodyRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }

  const bodyLines = useMemo(() => (body ? body.split("\n") : []), [body]);

  return (
    <div
      className={[
        styles.toolCall,
        statusType === "error" ? styles.error : "",
        treeItem ? styles.treeItem : "",
        !expandable ? styles.notExpandable : "",
        isAskUserTool ? styles.askUserMuted : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className={styles.toolCallHead}
        title={pathTitle}
        onClick={() => {
          if (expandable) toggleOpen();
        }}
      >
        <span
          className={`${styles.kindIcon}${statusType === "error" ? ` ${styles.error}` : ""}`}
          aria-hidden="true"
        >
          <StatusIcon size={12} />
        </span>
        <span className={styles.headText}>
          <span className={`${styles.action}${streaming ? " copilot-shimmer" : ""}`}>
            {actionLabel}
          </span>
          {previewPath ? (
            <FileChip path={previewPath} onOpen={onOpen} />
          ) : card.kind === "bash" && card.command ? (
            <code className={styles.cmdPill}>{card.command}</code>
          ) : (
            <span className={`${styles.headline}${streaming ? " copilot-shimmer" : ""}`}>
              {headline}
            </span>
          )}
          {metaLine ? <span className={styles.meta}>{metaLine}</span> : null}
          {(card.kind === "edit" || card.kind === "write") && card.stats ? (
            <span className={`${styles.meta} ${styles.stats}`}>
              <span className={styles.add}>+{card.stats.additions}</span>
              <span className={styles.del}>-{card.stats.deletions}</span>
            </span>
          ) : null}
          {(card.kind === "read" || card.kind === "bash") && card.truncated ? (
            <span className={styles.trunc}>{t.toolTruncated}</span>
          ) : null}
        </span>
        {canBackground ? (
          <Button
            size="small"
            className={styles.bgBtn}
            loading={backgroundBusy}
            title={t.toolMoveToBackground}
            onClick={(event) => {
              event.stopPropagation();
              void onBackground();
            }}
          >
            {t.toolMoveToBackground}
          </Button>
        ) : null}
        {expandable ? (
          <ChevronForwardOutline
            size={12}
            className={`${styles.hoverChev}${open ? ` ${styles.expanded}` : ""}`}
          />
        ) : null}
      </div>
      {open && card.kind === "todo" && todoItems.length ? (
        <ul className={styles.todoBody}>
          {todoItems.map((item) => (
            <li
              key={item.id}
              className={`${styles.todoRow}${item.done ? ` ${styles.done}` : ""}`}
            >
              {item.done ? (
                <CheckmarkCircleOutline size={14} className={styles.todoMark} />
              ) : (
                <EllipseOutline size={14} className={styles.todoMark} />
              )}
              <span className={styles.todoText}>{item.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {open && nestedCalls?.length ? (
        <div className={styles.nestedBody}>
          {nestedCalls.map((call) => {
            const NestedIcon = call.streaming
              ? EllipseOutline
              : call.isError
                ? CloseCircleOutline
                : CheckmarkCircleOutline;
            return (
              <div
                key={call.toolCallId}
                className={`${styles.nestedRow}${call.isError ? ` ${styles.error}` : ""}`}
              >
                <NestedIcon size={12} className={styles.nestedMark} />
                <span className={styles.nestedName}>{call.toolName}</span>
                {call.durationMs != null && !call.streaming ? (
                  <span className={styles.nestedMeta}>{formatDuration(call.durationMs)}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {open && body ? (
        <pre
          ref={bodyRef}
          className={`${styles.toolBody}${card.kind === "bash" ? ` ${styles.toolBodyBash}` : ""}`}
          onScroll={onBodyScroll}
        >
          <code>
            {bodyLines.map((line, i) => (
              <span
                key={i}
                className={`${styles.dline}${
                  isDiffBody && line.startsWith("+") && !line.startsWith("+++")
                    ? ` ${styles.add}`
                    : isDiffBody && line.startsWith("-") && !line.startsWith("---")
                      ? ` ${styles.del}`
                      : isDiffBody &&
                          (line.startsWith("@@") ||
                            line.startsWith("diff ") ||
                            line.startsWith("index ") ||
                            line.startsWith("+++") ||
                            line.startsWith("---"))
                        ? ` ${styles.meta}`
                        : ""
                }`}
              >
                {line || " "}
              </span>
            ))}
          </code>
        </pre>
      ) : null}
      {open && !body && !cardImages.length ? (
        <pre className={`${styles.toolBody} ${styles.empty}`}>{emptyBodyText}</pre>
      ) : null}
      {open && cardImages.length ? (
        <div className={styles.toolImages}>
          {cardImages.map((src, i) => (
            <img key={i} src={src} className={styles.toolImage} alt="" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default ToolCallCard;

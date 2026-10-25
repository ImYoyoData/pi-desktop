import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { Button } from "antd";
import {
  ChevronForwardOutline,
  CloseCircleOutline,
  CreateOutline,
  DocumentTextOutline,
  EyeOutline,
  FolderOutline,
  ListOutline,
  TerminalOutline,
  type IoniconProps,
} from "@renderer/components/icons/ionicons";
import type { ToolCard } from "@renderer/utils/tool-diff";
import { clipText, toolCardDurationMs, toolCardHasBody } from "@renderer/utils/tool-diff";
import type { ChatToolNestedCall } from "@renderer/stores/chat-reducer";
import { isToolCardOpen } from "@renderer/utils/tool-card-open";
import {
  directoryListTarget,
  genericStepPreview,
  genericStepTarget,
  isDirectoryListTool,
} from "@renderer/utils/structured-text";
import FileChip from "@renderer/components/FileChip";
import ToolBody from "@renderer/components/ToolBody";
import ToolNestedCalls from "@renderer/components/ToolNestedCalls";
import { useI18n } from "@renderer/i18n/use-i18n";
import { formatDuration } from "@renderer/utils/format-duration";
import { useAgentRunsStore } from "@renderer/stores/agent-runs";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useMessage } from "@renderer/services/feedback";
import { ASK_USER_TOOL_NAME } from "../../../shared/ask-user";
import { CODEMODE_TOOL_NAME } from "../../../shared/codemode-tool";
import styles from "./ToolCallCard.module.css";

type Props = {
  card: ToolCard;
  toolName: string;
  statusLabel: string;
  statusType: "default" | "success" | "error" | "info";
  streaming?: boolean;
  /** True once the whole turn finished: fold finished process rows (Codex-like). */
  autoCollapse?: boolean;
  /**
   * "row"：独立工具行（两行式布局）。
   * "step"：工作区块时间线里的一步（单行式，展开体紧跟在本行下方）。
   */
  variant?: "row" | "step";
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

/** 输出里的第一行有效文本，用于失败时的简短反馈。 */
function firstLine(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    return clipText(trimmed, 96);
  }
  return null;
}

/** 工具名过长时截断：mcp__server__tool 这类名字在时间线里会占掉一整列。 */
function shortToolName(name: string, max = 26): string {
  return clipText(name, max);
}

export function ToolCallCard({
  card,
  toolName,
  statusLabel,
  statusType,
  streaming,
  autoCollapse,
  variant = "row",
  detailCollapsed,
  nestedCalls,
  onOpen,
}: Props): ReactNode {
  const t = useI18n();
  const message = useMessage();
  const appearance = useAppearanceStore();
  const agentRuns = useAgentRunsStore();
  const sessions = useSessionsStore();
  const workspaceRoot = useWorkspaceStore((state) => state.root);

  /** Explicit user toggle; null = follow the automatic rule. */
  const [manuallyOpen, setManuallyOpen] = useState<boolean | null>(null);
  const [backgroundBusy, setBackgroundBusy] = useState(false);

  /**
   * 独立工具行的展开规则在 `utils/tool-card-open.ts`（纯函数 + 单测），这里只提供状态。
   * 时间线步骤默认折叠，正在流式输出的那一步自动展开；工作区块内的行传
   * `detailCollapsed`，关掉这个自动展开，免得压住整块摘要。
   */
  const open =
    variant === "step"
      ? manuallyOpen !== null
        ? manuallyOpen
        : Boolean(streaming) && !detailCollapsed
      : isToolCardOpen({
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
  }, [streaming]);

  const isAskUserTool = toolName === ASK_USER_TOOL_NAME;
  const sessionId = sessions.activeId;

  /** 内部调用数量（codemode 脚本里发出的工具调用）。 */
  const callCount = nestedCalls?.length ?? 0;
  /** codemode 用调用概况当标题，脚本首行代码不作标题。 */
  const showCallCount =
    card.kind === "generic" && (toolName === CODEMODE_TOOL_NAME || callCount > 0);

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

  const actionLabel = shortToolName(toolName);

  const KindIcon = kindIconFor(card.kind);
  const StatusIcon = statusType === "error" ? CloseCircleOutline : KindIcon;
  const statusClass =
    statusType === "error"
      ? styles.error
      : streaming
        ? styles.running
        : styles.success;

  /** 待办卡的固定动作文案；没有固定动作时返回 null，进度改由标题承担。 */
  const todoAction = useMemo(() => {
    if (card.kind !== "todo") return null;
    switch (card.action) {
      case "add":
        return t.toolTodoAdd;
      case "toggle":
        return t.toolTodoToggle;
      case "clear":
        return t.toolTodoClear;
      case "list":
        return t.toolTodoList;
      default:
        return null;
    }
  }, [card, t]);

  /** 处理后的结果反馈：只保留对用户有意义的结果（行数、改动、耗时、图片数）。 */
  const resultParts = useMemo(() => {
    const parts: string[] = [];
    const dur =
      (card.kind === "read" || card.kind === "bash") &&
      card.durationMs != null &&
      card.durationMs > 0
        ? formatDuration(card.durationMs)
        : null;
    if (card.kind === "read") {
      if (statusType === "error") {
        const line = firstLine(card.preview);
        if (line) parts.push(line);
      } else if (card.linesRead != null && card.totalLines != null) {
        parts.push(t.toolResultReadOf(card.linesRead, card.totalLines));
      } else if (card.linesRead != null) {
        parts.push(t.toolResultRead(card.linesRead));
      }
    } else if (card.kind === "bash") {
      if (statusType === "error") {
        const line = firstLine(card.preview);
        if (line) parts.push(line);
      } else {
        const lines =
          card.linesRead ?? (card.preview ? card.preview.split("\n").length : null);
        parts.push(lines != null ? t.toolResultLines(lines) : t.toolResultNoOutput);
      }
    } else if (card.kind === "todo") {
      if (card.items.length && todoAction) {
        parts.push(
          t.todoProgress(card.items.filter((item) => item.done).length, card.items.length),
        );
      }
    } else if (card.kind === "generic") {
      if (statusType === "error") {
        const line = firstLine(card.preview);
        if (line) parts.push(line);
      } else if (card.images.length) {
        parts.push(t.toolResultImages(card.images.length));
      } else {
        const out = card.preview?.trim() ?? "";
        parts.push(out ? t.toolResultLines(out.split("\n").length) : t.toolResultNoOutput);
      }
    }
    if (dur) parts.push(dur);
    if ((card.kind === "read" || card.kind === "bash") && card.truncated) {
      parts.push(t.toolTruncated);
    }
    return parts;
  }, [card, statusType, t, todoAction]);

  const headline = useMemo(() => {
    if (isAskUserTool) return "";
    if (card.kind === "bash") return card.command || toolName;
    if (card.kind === "generic") return card.summary || "";
    if (card.kind === "todo") {
      if (todoAction) return todoAction;
      return card.items.length
        ? t.todoProgress(
            card.items.filter((i) => i.done).length,
            card.items.length,
          )
        : toolName;
    }
    return fileName || toolName;
  }, [card, fileName, isAskUserTool, t, todoAction, toolName]);

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

  /** 标题目标：调用概况 / 文件 / 命令胶囊 / 摘要。 */
  function renderTarget(): ReactNode {
    if (showCallCount) {
      if (!callCount) return null;
      return (
        <span className={styles.callCount}>
          <span className={styles.sep}>·</span>
          {t.toolCallCount(callCount)}
        </span>
      );
    }
    if (previewPath) return <FileChip path={previewPath} onOpen={onOpen} />;
    if (card.kind === "bash" && card.command) {
      return <code className={styles.cmdPill}>{card.command}</code>;
    }
    return (
      <span className={`${styles.headline}${streaming ? " copilot-shimmer" : ""}`}>
        {headline}
      </span>
    );
  }

  const cardImages = useMemo<string[]>(
    () => (card.kind === "generic" ? card.images : []),
    [card],
  );

  const pathTitle =
    card.kind === "bash" || card.kind === "generic" || card.kind === "todo"
      ? undefined
      : (card.path ?? undefined);

  /** Rows with nothing to reveal drop the disclosure affordance (VS Code setExpandable). */
  const expandable = toolCardHasBody(card) || cardImages.length > 0;

  function toggleOpen(): void {
    setManuallyOpen(!open);
  }

  /** 目录列举工具（ls 等）：动词用「读取」，目标用文件夹 chip。 */
  const isDirList = card.kind === "generic" && isDirectoryListTool(toolName);

  /** 时间线步骤的图标：目录列举用文件夹，失败仍用叉。 */
  const StepIcon =
    statusType === "error" ? CloseCircleOutline : isDirList ? FolderOutline : KindIcon;

  const stepVerb = shortToolName(toolName);

  /**
   * generic 工具要分开说两件事：
   * 目标 = 它读/写/查的是哪个路径（行里必须显示这个）；
   * 摘要 = 它产出了多少（次要位，不顶替目标）。
   */
  const genericSummary = useMemo(() => {
    if (card.kind !== "generic") return { target: null, preview: null, isDir: false };
    const dirTarget = isDirectoryListTool(toolName)
      ? directoryListTarget(card.args, workspaceRoot)
      : null;
    const target = dirTarget ?? genericStepTarget(card.args);
    const preview = genericStepPreview(card, toolName, {
      isError: statusType === "error",
    });
    return { target, preview, isDir: Boolean(dirTarget) };
  }, [card, statusType, toolName, workspaceRoot]);

  /** 结果摘要：只说「产出了多少 / 什么结构」，文案按当前语言格式化。 */
  const previewText = useMemo(() => {
    const preview = genericSummary.preview;
    if (!preview) return null;
    if (preview.kind === "count") return t.toolBodyPathCount(preview.count);
    if (preview.kind === "sections") {
      const sections = t.toolBodyScriptSections(preview.count);
      return preview.wallTime != null
        ? `${t.toolBodyWallTime(preview.wallTime)} · ${sections}`
        : sections;
    }
    const head = preview.keys.slice(0, 3).join(", ");
    return `{ ${head}${preview.keys.length > 3 ? ", …" : ""} }`;
  }, [genericSummary.preview, t]);

  /** 时间线步骤的目标：文件/目录用 chip、命令用等宽字体、其余用参数里的路径。 */
  const stepTarget = useMemo<ReactNode>(() => {
    if (previewPath) return <FileChip path={previewPath} onOpen={onOpen} />;
    if (card.kind === "bash" && card.command) {
      return <code className={styles.stepCmd}>{card.command}</code>;
    }
    if (genericSummary.target) {
      if (genericSummary.isDir) {
        return <FileChip path={genericSummary.target} label={genericSummary.target} dir />;
      }
      return <span className={styles.stepText}>{genericSummary.target}</span>;
    }
    if (previewText) {
      return <span className={styles.stepText}>{previewText}</span>;
    }
    return headline ? <span className={styles.stepText}>{headline}</span> : null;
  }, [card, genericSummary, headline, onOpen, previewPath, previewText]);

  /** 摘要只做次要位；目标已经用它兜底时不再重复。 */
  const stepPreview = genericSummary.target ? previewText : null;

  /** 时间线步骤右侧的度量：行数 / 改动数 / 退出码 / 耗时。 */
  const stepMeta = useMemo<ReactNode>(() => {
    const parts: ReactNode[] = [];
    if (card.kind === "read" && card.linesRead != null) {
      parts.push(t.toolBodyLines(card.linesRead));
    }
    if ((card.kind === "edit" || card.kind === "write") && card.stats) {
      parts.push(
        <span key="stats" className={styles.stepStats}>
          <span className={styles.add}>+{card.stats.additions}</span>{" "}
          <span className={styles.del}>−{card.stats.deletions}</span>
        </span>,
      );
    }
    if (card.kind === "bash" && card.exitCode != null) {
      parts.push(
        <span
          key="exit"
          className={card.exitCode === 0 ? styles.stepOk : styles.stepErr}
        >
          {t.toolBodyExitCode(card.exitCode)}
        </span>,
      );
    }
    const durationMs = toolCardDurationMs(card);
    if (durationMs) parts.push(formatDuration(durationMs));
    if (!parts.length) return null;
    return parts.map((part, index) => (
      <span key={index} className={styles.stepMetaItem}>
        {part}
      </span>
    ));
  }, [card, t]);

  /** 内部调用列表：独立工具行挂在标题下方，时间线步骤挂在展开体里。 */
  const nestedCallsBlock = nestedCalls?.length ? (
    <ToolNestedCalls calls={nestedCalls} onOpen={onOpen} />
  ) : null;

  return (
    <div
      className={[
        styles.toolCall,
        !expandable ? styles.notExpandable : "",
        isAskUserTool ? styles.askUserMuted : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {variant === "step" ? (
        <div
          className={styles.stepHead}
          title={pathTitle}
          onClick={() => {
            if (expandable) toggleOpen();
          }}
        >
          <span className={`${styles.stepDot} ${statusClass}`} aria-hidden="true">
            <StepIcon size={11} />
          </span>
          <span className={styles.stepVerb}>{stepVerb}</span>
          <span className={styles.stepTarget}>{stepTarget}</span>
          {stepPreview ? <span className={styles.stepPreview}>{stepPreview}</span> : null}
          <span className={styles.stepMeta}>{stepMeta}</span>
          {expandable ? (
            <ChevronForwardOutline
              size={12}
              className={`${styles.hoverChev}${open ? ` ${styles.expanded}` : ""}`}
            />
          ) : null}
        </div>
      ) : (
        <div
          className={styles.toolCallHead}
          title={pathTitle}
          onClick={() => {
            if (expandable) toggleOpen();
          }}
        >
          <span className={`${styles.kindIcon} ${statusClass}`} aria-hidden="true">
            <StatusIcon size={13} />
          </span>
          <div className={styles.headText}>
            <div className={styles.titleRow}>
              <span className={`${styles.action}${streaming ? " copilot-shimmer" : ""}`}>
                {actionLabel}
              </span>
              {renderTarget()}
              <span className={styles.resultGroup}>
                <span className={styles.sep}>·</span>
                <span className={`${styles.resultStatus} ${statusClass}`}>{statusLabel}</span>
                {resultParts.length ? (
                  <span className={styles.resultText}>{resultParts.join(" · ")}</span>
                ) : null}
                {(card.kind === "edit" || card.kind === "write") && card.stats ? (
                  <span className={styles.resultStats}>
                    <span className={styles.add}>+{card.stats.additions}</span>
                    <span className={styles.del}>−{card.stats.deletions}</span>
                  </span>
                ) : null}
              </span>
            </div>
            {nestedCallsBlock}
          </div>
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
      )}
      {open ? (
        <div className={variant === "step" ? styles.stepBody : styles.rowBody}>
          <ToolBody
            card={card}
            streaming={streaming}
            toolName={toolName}
            isError={statusType === "error"}
            onOpen={onOpen}
          />
          {variant === "step" ? nestedCallsBlock : null}
          {cardImages.length ? (
            <div className={styles.toolImages}>
              {cardImages.map((src, i) => (
                <img key={i} src={src} className={styles.toolImage} alt="" />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default ToolCallCard;

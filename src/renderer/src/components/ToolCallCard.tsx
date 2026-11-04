import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Button, Image } from "antd";
import {
  ArrowUndoOutline,
  BookmarkOutline,
  ChatbubbleEllipsesOutline,
  ChevronForwardOutline,
  CloseOutline,
  CodeSlashOutline,
  CreateOutline,
  DocumentTextOutline,
  EarthOutline,
  EditPencilOutline,
  EllipsisHorizontalOutline,
  ExtensionPuzzleOutline,
  EyeOutline,
  FileTrayFullOutline,
  FlagOutline,
  FolderOutline,
  GitBranchOutline,
  GitCompareOutline,
  GlobeOutline,
  HardwareChipOutline,
  ListOutline,
  PeopleOutline,
  SearchOutline,
  SparklesOutline,
  SquareTerminalOutline,
  SyncOutline,
  TerminalOutline,
  type IoniconProps,
} from "@renderer/components/icons/ionicons";
import type { ToolCard } from "@renderer/utils/tool-diff";
import { toolCardDurationMs, toolCardExpandable } from "@renderer/utils/tool-diff";
import { clipText } from "@renderer/utils/tool-args";
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
import {
  toolFamily,
  toolCountLabel,
  toolResultCount,
  type ToolFamily,
} from "@renderer/utils/tool-family";
import { waitHeadline, waitElapsedMs, waitJobCounts } from "@renderer/utils/tool-wait";
import { useNow } from "@renderer/utils/use-now";
import { ASK_USER_TOOL_NAME } from "../../../shared/ask-user";
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
      return CreateOutline;
    case "edit":
      return EditPencilOutline;
    case "bash":
      return SquareTerminalOutline;
    case "grep":
      return SearchOutline;
    case "todo":
      return ListOutline;
    case "wait":
      return EllipsisHorizontalOutline;
    case "generic":
    case "other":
      return DocumentTextOutline;
    default:
      return DocumentTextOutline;
  }
}

/** generic 兜底工具的图标族：浏览器、扩展、搜索、脚本、清单。 */
function familyIconFor(family: ToolFamily): KindIconComponent | null {
  switch (family) {
    case "browser":
      return GlobeOutline;
    case "mcp":
      return ExtensionPuzzleOutline;
    case "toolSearch":
      return SearchOutline;
    case "codemode":
      return CodeSlashOutline;
    case "pathList":
      return FileTrayFullOutline;
    default:
      return null;
  }
}

/** 详情卡按具体工具取图标：同一套卡片外壳，不同工具仍有自己的身份。 */
function detailIconFor(tool: string): KindIconComponent {
  switch (tool) {
    case "ast_grep":
      return SearchOutline;
    case "ast_edit":
    case "memory_edit":
      return EditPencilOutline;
    case "eval":
    case "codemode":
      return CodeSlashOutline;
    case "task":
    case "ask_user":
      return PeopleOutline;
    case "ask":
      return ChatbubbleEllipsesOutline;
    case "debug":
    case "computer":
      return TerminalOutline;
    case "ida":
      return HardwareChipOutline;
    case "github":
      return GitBranchOutline;
    case "lsp":
      return GitCompareOutline;
    case "checkpoint":
      return BookmarkOutline;
    case "rewind":
      return ArrowUndoOutline;
    case "context_notes":
      return DocumentTextOutline;
    case "new_context":
      return CreateOutline;
    case "security_scan":
      return FlagOutline;
    case "web_search":
      return EarthOutline;
    case "retain":
    case "recall":
    case "reflect":
    case "learn":
      return SparklesOutline;
    case "manage_skill":
      return ExtensionPuzzleOutline;
    case "tool_search":
      return SearchOutline;
    default:
      if (tool.startsWith("browser_")) return GlobeOutline;
      if (tool.startsWith("mcp__")) return ExtensionPuzzleOutline;
      if (tool === "find" || tool === "glob" || tool === "ls") return FileTrayFullOutline;
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
  const sessions = useSessionsStore();
  const workspaceRoot = useWorkspaceStore((state) => state.root);

  /** Explicit user toggle; null = follow the automatic rule. */
  const [manuallyOpen, setManuallyOpen] = useState<boolean | null>(null);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  /** wait 运行中每秒刷新，折叠行也能看到累计等待时长。 */
  const waitNow = useNow(
    card.kind === "wait" && Boolean(streaming) && card.startedAt != null,
  );

  /**
   * 独立工具行的展开规则在 `utils/tool-card-open.ts`（纯函数 + 单测），这里只提供状态。
   * 时间线步骤默认折叠，正在流式输出的那一步自动展开；工作区块内的行传
   * `detailCollapsed`，关掉这个自动展开，免得压住整块摘要。
   */
  const rawOpen =
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
  /** codemode 有内部调用时用调用概况当标题，脚本首行代码不作标题。 */
  const showCallCount = callCount > 0;

  /** 只有还在跑的命令才有可操作对象：已结束的卡片不能绑到同名的新 run。 */
  const command = card.kind === "bash" ? (card.command?.trim() ?? "") : "";
  const blockingRunId = useAgentRunsStore((state) =>
    streaming && sessionId && command
      ? (state.findBlockingRun(sessionId, command)?.id ?? null)
      : null,
  );
  const resyncRuns = useAgentRunsStore((state) => state.resync);
  const backgroundRun = useAgentRunsStore((state) => state.background);

  /** 卡片在跑却找不到 run（事件丢失、渲染进程重载）：补一次主进程快照，节流在 store 里。 */
  useEffect(() => {
    if (!streaming || blockingRunId || !command || !sessionId || !workspaceRoot) return;
    void resyncRuns(workspaceRoot);
  }, [blockingRunId, command, resyncRuns, sessionId, streaming, workspaceRoot]);

  const canBackground = Boolean(blockingRunId);

  async function onBackground(): Promise<void> {
    const runId = blockingRunId;
    if (!runId || backgroundBusy) return;
    setBackgroundBusy(true);
    try {
      await backgroundRun(runId);
      message.success(t.toolBackgrounded);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t.toolBackgroundFailed);
    } finally {
      setBackgroundBusy(false);
    }
  }

  const fileName = useMemo(() => {
    const current = card;
    if (
      current.kind === "bash" ||
      current.kind === "grep" ||
      current.kind === "generic" ||
      current.kind === "todo" ||
      current.kind === "wait" ||
      current.kind === "detail"
    ) {
      return null;
    }
    const p = current.path;
    if (!p) return null;
    const parts = p.split(/[/\\]/);
    return parts[parts.length - 1] || p;
  }, [card]);

  const actionLabel = shortToolName(toolName);

  const family = toolFamily(toolName);
  /** 结果量级：清单条目 / 浏览器元素 / tool_search 的工具数。 */
  const resultCount = useMemo(
    () =>
      card.kind === "generic" && !streaming
        ? toolResultCount(toolName, card.preview, card.structured)
        : null,
    [card, streaming, toolName],
  );

  const KindIcon = kindIconFor(card.kind);
  const statusClass =
    statusType === "error"
      ? styles.error
      : streaming
        ? styles.running
        : styles.success;

  /** 工具图标只保留失败/进行中的语义色，正常状态用中性图标色。 */
  const iconTone =
    statusType === "error" ? styles.error : streaming ? styles.running : "";

  /** 待办卡的固定动作文案；没有固定动作时返回 null，进度改由标题承担。 */
  const todoAction = useMemo(() => {
    if (card.kind !== "todo") return null;
    switch (card.action) {
      case "add":
      case "append":
        return t.toolTodoAdd;
      case "toggle":
        return t.toolTodoToggle;
      case "clear":
        return t.toolTodoClear;
      case "list":
      case "view":
        return t.toolTodoList;
      case "init":
        return t.toolTodoInit;
      case "start":
        return t.toolTodoStart;
      case "done":
        return t.toolTodoDone;
      case "block":
        return t.toolTodoBlock;
      case "unblock":
        return t.toolTodoUnblock;
      case "rm":
        return t.toolTodoRemove;
      case "drop":
        return t.toolTodoDrop;
      default:
        return null;
    }
  }, [card, t]);

  /** 处理后的结果反馈：只保留对用户有意义的结果（行数、改动、耗时、图片数）。 */
  const resultParts = useMemo(() => {
    const parts: string[] = [];
    const dur =
      (card.kind === "read" ||
        card.kind === "bash" ||
        card.kind === "grep" ||
        card.kind === "wait") &&
      card.durationMs != null &&
      card.durationMs > 0
        ? formatDuration(card.durationMs)
        : null;
    if (card.kind === "read") {
      if (statusType === "error") {
        const line = firstLine(card.preview);
        if (line) parts.push(line);
      } else if (card.linesRead != null) {
        const start = card.startLine ?? 1;
        parts.push(
          t.toolResultReadRange(start, start + card.linesRead - 1, card.totalLines),
        );
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
      if (card.total != null) {
        parts.push(
          t.todoProgress(
            card.items.filter((item) => item.done).length,
            card.total,
          ),
        );
      }
    } else if (card.kind === "grep") {
      if (statusType === "error") {
        const line = firstLine(card.preview);
        if (line) parts.push(line);
      } else if (card.matchCount) {
        parts.push(t.toolBodyGrepMatches(card.matchCount, card.hits.length));
      } else if (card.noMatches) {
        parts.push(t.toolBodyGrepNoMatches);
      }
      if (card.searchPath && card.searchPath !== ".") parts.push(card.searchPath);
      if (card.glob) parts.push(card.glob);
      if (card.notices.length) parts.push(t.toolTruncated);
    } else if (card.kind === "wait") {
      if (statusType === "error") {
        const line = firstLine(card.text);
        if (line) parts.push(line);
      } else {
        const counts = waitJobCounts(card.jobs);
        if (counts.failed) parts.push(t.toolWaitFailedCount(counts.failed));
        if (counts.cancelled) parts.push(t.toolWaitCancelledCount(counts.cancelled));
      }
      if (card.interrupted) parts.push(t.toolWaitInterrupted);
      if (streaming) {
        const elapsed = waitElapsedMs(card.startedAt, card.durationMs, true, waitNow);
        if (elapsed != null) {
          parts.push(t.toolWaitElapsed(formatDuration(elapsed)));
        }
      }
    } else if (card.kind === "detail") {
      if (statusType === "error") {
        const line = firstLine(card.sections.find((section) => section.kind === "text")?.text ?? null);
        if (line) parts.push(line);
      } else {
        for (const chip of card.chips.slice(0, 3)) {
          parts.push(
            chip.kind === "text"
              ? chip.text
              : t.toolDetailCount(chip.unit, chip.value),
          );
        }
        for (const flag of card.flags.slice(0, 3)) {
          if (flag === "ok" && statusType === "success") continue;
          parts.push(t.toolDetailFlag(flag));
        }
      }
    } else if (card.kind === "generic") {
      if (statusType === "error") {
        const line = firstLine(card.preview);
        if (line) parts.push(line);
      } else if (card.images.length) {
        parts.push(t.toolResultImages(card.images.length));
      } else if (resultCount) {
        parts.push(toolCountLabel(t, resultCount));
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
  }, [card, statusType, streaming, t, todoAction, resultCount, waitNow]);

  const headline = useMemo(() => {
    if (isAskUserTool) return "";
    if (card.kind === "bash") return card.command || toolName;
    if (card.kind === "grep") return card.pattern || toolName;
    if (card.kind === "wait") {
      return waitHeadline(card.jobs, t, Boolean(streaming));
    }
    if (card.kind === "generic") return card.summary || "";
    if (card.kind === "detail") return card.target || card.summary || "";
    if (card.kind === "todo") {
      if (todoAction) return todoAction;
      if (card.total != null) {
        return t.todoProgress(
          card.items.filter((i) => i.done).length,
          card.total,
        );
      }
      return card.items.length ? t.toolTodo : t.toolTodoEmpty;
    }
    return fileName || toolName;
  }, [card, fileName, isAskUserTool, streaming, t, todoAction, toolName]);

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
    if (card.kind === "grep" && card.pattern) {
      return <code className={styles.cmdPill}>{card.pattern}</code>;
    }
    if (!headline) return null;
    return (
      <span className={`${styles.headline}${streaming ? " copilot-shimmer" : ""}`}>
        {headline}
      </span>
    );
  }

  const cardImages = useMemo<string[]>(
    () =>
      card.kind === "generic"
        ? card.images
        : card.kind === "detail"
          ? card.images
          : [],
    [card],
  );

  const pathTitle =
    card.kind === "bash" ||
    card.kind === "grep" ||
    card.kind === "generic" ||
    card.kind === "todo" ||
    card.kind === "wait" ||
    card.kind === "detail"
      ? undefined
      : (card.path ?? undefined);

  /** Rows with nothing to reveal drop the disclosure affordance (VS Code setExpandable). */
  const expandable = toolCardExpandable(card) || cardImages.length > 0;
  /** 没有展开体时即使状态为 open 也不渲染空壳，箭头方向跟随实际展开体。 */
  const expanded = rawOpen && expandable;

  function toggleOpen(): void {
    setManuallyOpen(!rawOpen);
  }

  /** 折叠行当按钮用：键盘也要能展开/收起。 */
  function onHeadKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!expandable) return;
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleOpen();
  }

  /** 目录列举工具（ls 等）：动词用「读取」，目标用文件夹 chip。 */
  const isDirList = card.kind === "generic" && isDirectoryListTool(toolName);

  /** 工具图标：运行中转圈，失败用叉（不带圆环），目录列举用文件夹。 */
  const spinning = Boolean(streaming) && statusType !== "error";
  const FamilyIcon = familyIconFor(family);
  const ToolIcon =
    statusType === "error"
      ? CloseOutline
      : spinning
        ? SyncOutline
        : card.kind === "detail"
          ? detailIconFor(card.tool)
          : isDirList
            ? FolderOutline
            : (FamilyIcon ?? KindIcon);
  const iconClass = `${styles.kindIcon} ${iconTone}${spinning ? ` ${styles.spinIcon}` : ""}`;
  const stepIconClass = `${styles.stepIcon} ${iconTone}${spinning ? ` ${styles.spinIcon}` : ""}`;

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
    if (card.kind === "grep" && card.pattern) {
      return <code className={styles.stepCmd}>{card.pattern}</code>;
    }
    if (card.kind === "detail" && card.target) {
      return <span className={styles.stepText}>{card.target}</span>;
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
  const stepPreview =
    card.kind === "detail"
      ? (card.summary ??
        (card.chips[0]?.kind === "text"
          ? card.chips[0].text
          : card.chips[0]
            ? t.toolDetailCount(card.chips[0].unit, card.chips[0].value)
            : null))
      : card.kind === "grep"
      ? card.matchCount
        ? t.toolBodyGrepMatches(card.matchCount, card.hits.length)
        : card.noMatches
          ? t.toolBodyGrepNoMatches
          : null
      : card.kind === "wait"
        ? resultParts.length
          ? resultParts.join(" · ")
          : null
        : resultCount
          ? toolCountLabel(t, resultCount)
          : genericSummary.target
            ? previewText
            : null;

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
    if (card.kind === "grep" && card.notices.length) {
      parts.push(<span key="truncated">{t.toolTruncated}</span>);
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

  /** 阻塞中的命令可以甩到后台：贴标题行行尾，不另占一行高度。 */
  const backgroundBtn = canBackground ? (
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
          data-fold-toggle={expandable ? "" : undefined}
          role={expandable ? "button" : undefined}
          aria-expanded={expandable ? expanded : undefined}
          tabIndex={expandable ? 0 : undefined}
          onClick={() => {
            if (expandable) toggleOpen();
          }}
          onKeyDown={onHeadKeyDown}
        >
          <span className={stepIconClass} aria-hidden="true">
            <ToolIcon size={13} />
          </span>
          <span className={styles.stepVerb}>{stepVerb}</span>
          <span className={styles.stepTarget}>{stepTarget}</span>
          {stepPreview ? <span className={styles.stepPreview}>{stepPreview}</span> : null}
          <span className={styles.stepMeta}>{stepMeta}</span>
          {expandable ? (
            <ChevronForwardOutline
              size={12}
              className={`${styles.hoverChev}${expanded ? ` ${styles.expanded}` : ""}`}
            />
          ) : null}
          {backgroundBtn}
        </div>
      ) : (
        <div
          className={styles.toolCallHead}
          title={pathTitle}
          data-fold-toggle={expandable ? "" : undefined}
          role={expandable ? "button" : undefined}
          aria-expanded={expandable ? expanded : undefined}
          tabIndex={expandable ? 0 : undefined}
          onClick={() => {
            if (expandable) toggleOpen();
          }}
          onKeyDown={onHeadKeyDown}
        >
          <span className={iconClass} aria-hidden="true">
            <ToolIcon size={13} />
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
          </div>
          {expandable ? (
            <ChevronForwardOutline
              size={12}
              className={`${styles.hoverChev}${expanded ? ` ${styles.expanded}` : ""}`}
            />
          ) : null}
          {backgroundBtn}
        </div>
      )}
      {variant === "row" && nestedCallsBlock ? (
        <div className={styles.nestedRow}>{nestedCallsBlock}</div>
      ) : null}
      {expanded ? (
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
                <Image
                  key={i}
                  src={src}
                  className={styles.toolImage}
                  alt=""
                  styles={{
                    root: { maxWidth: "100%" },
                    image: {
                      width: "auto",
                      height: "auto",
                      maxWidth: "min(100%, 420px)",
                      maxHeight: 260,
                    },
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default ToolCallCard;

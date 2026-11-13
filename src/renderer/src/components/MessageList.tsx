import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { ArrowDownOutline } from "@renderer/components/icons/ionicons";
import type { ChatMessage, ChatRetryHint } from "@renderer/stores/chat";
import { useChatStore } from "@renderer/stores/chat";
import { useCheckpointStore } from "@renderer/stores/checkpoint";
import { useComposerStore } from "@renderer/stores/composer";
import { useSendQueueStore } from "@renderer/stores/send-queue";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { usePreviewStore } from "@renderer/stores/preview";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useI18n } from "@renderer/i18n/use-i18n";
import { useDialog, useMessage, type DialogHandle } from "@renderer/services/feedback";
import WorkSectionGroup from "@renderer/components/WorkSectionGroup";
import AgentWaitIndicator from "@renderer/components/AgentWaitIndicator";
import AskUserStrip from "@renderer/components/AskUserStrip";
import ExtensionUiStrip from "@renderer/components/ExtensionUiStrip";
import { toolCardFor as toolCard } from "@renderer/utils/tool-diff";
import { toolDisplayName } from "@renderer/utils/tool-xdev";
import {
  buildFinalAnswerIds,
  buildRoundUserByRow,
  buildSettledRowIds,
  buildWorkSectionMembership,
  findPendingAskRowId,
  isLatestUserRead,
  lastIdPerRound,
  type UserMessage,
} from "@renderer/utils/message-rows";
import { agentOutputSilenceMs } from "@renderer/utils/agent-wait";
import type { ChatState } from "@renderer/stores/chat-reducer";
import { buildUserRowView, type UserRowView } from "@renderer/utils/message-user";
import { planComposerTags } from "@renderer/utils/composer-payload";
import {
  collectTurnFileChanges,
  type TurnFileChanges,
} from "@renderer/utils/turn-file-changes";
import {
  assistantModelDetail as assistantModelDetailOf,
  assistantStats as assistantStatsOf,
  buildModelNameMap,
  toolStatus as toolStatusOf,
  type CompactDetail,
  type ToolMessage,
  type ToolStatusLabel,
} from "@renderer/utils/message-metrics";
import { preloadMarkdownView } from "./message-list/lazy-markdown";
import { useMessageScroll } from "./message-list/use-message-scroll";
import {
  AssistantMessageRow,
  ErrorMessageRow,
  RetryHintRow,
  SummaryMessageRow,
  ToolMessageRow,
  UserMessageRow,
} from "./message-list/MessageRow";
import styles from "./MessageList.module.css";

type Props = {
  messages: ChatMessage[];
  streaming: ChatMessage | null;
  running: boolean;
  retryHint?: ChatRetryHint | null;
  historyLoading?: boolean;
  /** 面板被折叠/让位给编辑器区域时为 false。 */
  visible?: boolean;
};

function rowRoleClass(role: ChatMessage["role"]): string {
  switch (role) {
    case "user":
      return styles.rowUser;
    case "assistant":
      return styles.rowAssistant;
    case "tool":
      return styles.rowTool;
    case "error":
      return styles.rowError;
    default:
      return "";
  }
}

export function MessageList({
  messages,
  streaming,
  running,
  retryHint,
  historyLoading,
  visible,
}: Props): ReactNode {
  const t = useI18n();
  const autoExpandSummary = useAppearanceStore((s) => s.autoExpandSummary);
  const chat = useChatStore();
  const checkpoints = useCheckpointStore();
  const sendQueue = useSendQueueStore();
  const sessions = useSessionsStore();
  const messageApi = useMessage();
  const dialog = useDialog();

  useEffect(() => preloadMarkdownView(), []);

  /**
   * 完整消息序列（含 streaming）。历史轮的过程行必须保留：它们会按 work section
   * 折叠成小结条，展开后仍能看到工具调用与思考；直接裁掉等于丢数据。
   */
  const allMessages = useMemo<ChatMessage[]>(() => {
    const list = [...messages];
    if (streaming) list.push(streaming);
    return list;
  }, [messages, streaming]);

  const workSectionMembership = useMemo(
    () => buildWorkSectionMembership(allMessages),
    [allMessages],
  );

  /**
   * 虚拟化的行序列：工作分组的从属行不单独成行 —— 分组内容整体挂在首行上，
   * 若从属行独立成行，首行被裁出窗口时会留下一整段空白。
   */
  const renderRows = useMemo(
    () => allMessages.filter((m) => workSectionMembership.get(m.id)?.isLead !== false),
    [allMessages, workSectionMembership],
  );

  const settledRowIds = useMemo(
    () => buildSettledRowIds(allMessages, workSectionMembership),
    [allMessages, workSectionMembership],
  );

  const pendingAskRowId = useMemo(
    () => findPendingAskRowId(allMessages, chat.activePendingAskUser),
    [allMessages, chat.activePendingAskUser],
  );

  const dockAsk = Boolean(chat.activePendingAskUser) && !pendingAskRowId;

  const finalAnswerIds = useMemo(
    () => buildFinalAnswerIds(allMessages),
    [allMessages],
  );

  const latestUserMessageId = useMemo(() => {
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const m = allMessages[i];
      if (m?.role === "user") return m.id;
    }
    return null;
  }, [allMessages]);

  const latestUserRead = useMemo(() => isLatestUserRead(allMessages), [allMessages]);

  const rowsRef = useRef({
    allMessages,
    renderRows,
    workSectionMembership,
    settledRowIds,
    finalAnswerIds,
    latestUserMessageId,
  });
  rowsRef.current = {
    allMessages,
    renderRows,
    workSectionMembership,
    settledRowIds,
    finalAnswerIds,
    latestUserMessageId,
  };

  function rowSettled(msg: ChatMessage): boolean {
    return rowsRef.current.settledRowIds.has(msg.id);
  }

  function isFinalAnswer(msg: ChatMessage): boolean {
    return msg.role === "assistant" && rowsRef.current.finalAnswerIds.has(msg.id);
  }

  /** 更早历史的分页游标；自动加载用它判断是否还能继续往前翻。 */
  const olderState = useMemo(() => {
    const id = sessions.activeId;
    if (!id) return null;
    return chat.olderBySession[id] ?? null;
  }, [chat.olderBySession, sessions.activeId]);

  const sessionId = sessions.activeId;

  const scroll = useMessageScroll({
    sessionId,
    visible,
    historyLoading,
    messages,
    allMessagesLength: allMessages.length,
    latestUserMessageId,
    renderRowsLength: renderRows.length,
    streaming,
    running,
    olderState,
  });

  /** User cards the user explicitly expanded (id → true). Default: collapsed. */
  const [expandedUserIds, setExpandedUserIds] = useState<Set<string>>(new Set());
  /** 折叠态下真正被四行截断的行；按钮只在内容确实看不全时出现。 */
  const [overflowUserIds, setOverflowUserIds] = useState<Set<string>>(new Set());

  const markUserOverflow = useCallback(
    (id: string, overflowing: boolean): void => {
      setOverflowUserIds((current) => {
        if (current.has(id) === overflowing) return current;
        const next = new Set(current);
        if (overflowing) next.add(id);
        else next.delete(id);
        return next;
      });
    },
    [],
  );

  function isUserExpanded(id: string): boolean {
    return expandedUserIds.has(id);
  }

  function toggleUserExpanded(id: string): void {
    setExpandedUserIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * The current round finished (nothing streaming and nothing running): fold all
   * process rows (tools + thinking) so only the user question and final answer
   * stay prominent, Codex-style. Users can still re-expand any row manually.
   */
  const turnDone = !running && !streaming;

  /**
   * opencode DiffSummary：每轮（user 行分隔）的文件改动汇总，挂在轮末最终回答
   * 下方。统计用完整消息 — 工具行折叠在 work section 里，计数仍要算上它们。
   */
  const turnDiffsByRow = useMemo(() => {
    const out = new Map<string, TurnFileChanges>();
    const stats = collectTurnFileChanges(allMessages, toolCard, turnDone);
    if (!stats.size) return out;
    const sourceIds = lastIdPerRound(allMessages, (msg) => msg.role !== "user");
    const answerIds = lastIdPerRound(
      allMessages,
      (msg) => msg.role === "assistant" && Boolean(msg.text),
    );
    for (let i = 0; i < sourceIds.length; i++) {
      const sourceId = sourceIds[i];
      const rowId = answerIds[i];
      const changes = sourceId ? stats.get(sourceId) : undefined;
      if (changes && rowId) out.set(rowId, changes);
    }
    return out;
  }, [allMessages, turnDone]);

  function turnDiffFor(msg: ChatMessage): TurnFileChanges | null {
    return turnDiffsByRow.get(msg.id) ?? null;
  }

  const [openTurnDiffs, setOpenTurnDiffs] = useState<Set<string>>(new Set());

  function isTurnDiffOpen(id: string): boolean {
    return openTurnDiffs.has(id);
  }

  function toggleTurnDiff(id: string): void {
    setOpenTurnDiffs((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const [openSummaries, setOpenSummaries] = useState<Set<string>>(new Set());

  function isSummaryOpen(id: string): boolean {
    return openSummaries.has(id);
  }

  function toggleSummary(id: string): void {
    setOpenSummaries((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 用户行的展示态预计算：模板查表，避免每行重复跑前言剥离 / 标签过滤。 */
  const userViewByRow = useMemo(() => {
    const out = new Map<string, UserRowView>();
    for (const msg of messages) {
      if (msg.role === "user") out.set(msg.id, buildUserRowView(msg));
    }
    return out;
  }, [messages]);

  function userRow(msg: ChatMessage): UserRowView {
    const view = userViewByRow.get(msg.id);
    if (view) return view;
    return msg.role === "user"
      ? buildUserRowView(msg)
      : { text: "", tags: [], needsToggle: false };
  }

  function openPreview(filePath: string): void {
    usePreviewStore.getState().openPreview(filePath);
    useRightTabsStore.getState().addTab("preview", {
      filePath,
      label: filePath.split(/[/\\]/).pop() ?? t.preview,
    });
  }

  function toolStatus(msg: ToolMessage): ToolStatusLabel {
    return toolStatusOf(msg);
  }

  /** `provider/id` → 模型目录中的显示名。 */
  const [modelNames, setModelNames] = useState<Record<string, string>>({});

  async function loadModelNames(): Promise<void> {
    try {
      const data = await window.api.models.get();
      setModelNames(buildModelNameMap(data.available));
    } catch {
      // 取不到目录时退回原始 model id
    }
  }

  useEffect(() => {
    void loadModelNames();
  }, []);

  /**
   * 尾部指标只在最终回答行渲染，预先算成表：模板里直接查表，
   * 避免每行每次渲染重复做 toLocaleString / 思考级别映射。单遍 O(n)。
   */
  const statsByRow = useMemo(() => {
    const out = new Map<string, CompactDetail | null>();
    for (const msg of allMessages) {
      if (msg.role === "assistant" && finalAnswerIds.has(msg.id)) {
        out.set(msg.id, assistantStatsOf(msg));
      }
    }
    return out;
  }, [allMessages, finalAnswerIds]);

  const modelDetailByRow = useMemo(() => {
    const out = new Map<string, CompactDetail | null>();
    const usage = sessions.activeContextUsage;
    for (const msg of allMessages) {
      if (msg.role === "assistant" && finalAnswerIds.has(msg.id)) {
        out.set(msg.id, assistantModelDetailOf(msg, usage, modelNames));
      }
    }
    return out;
  }, [allMessages, finalAnswerIds, modelNames, sessions.activeContextUsage]);

  async function copyText(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
    messageApi.success(t.copied);
  }

  /** 把一条 user 气泡放回输入框（重新编辑或还原检查点后用）。 */
  function loadComposerFromUser(msg: UserMessage): void {
    const view = buildUserRowView(msg);
    const composer = useComposerStore.getState();
    composer.clear();
    composer.setDraft(view.text);
    for (const img of msg.images ?? []) {
      composer.addImageFromDataUrl(img.dataUrl);
    }
    for (const action of planComposerTags(view.tags)) {
      if (action.kind === "file") {
        composer.addFileTag(action.value);
      } else if (action.kind === "url") {
        composer.addUrlTag(action.value);
      } else if (action.kind === "citation") {
        composer.addCitation({ url: action.url, selector: "", text: action.text, htmlSnippet: "" });
      }
    }
  }

  function onEditUser(msg: Extract<ChatMessage, { role: "user" }>): void {
    const id = sessionId;
    if (!id) return;
    const edited = chat.beginEditUser(id, msg.id);
    if (!edited) return;
    if (sendQueue.editingId) sendQueue.setEditing(id, null);
    loadComposerFromUser(edited);
    messageApi.info(t.loadedForReEdit);
  }

  /**
   * 回退到本轮结束：保留本轮问答，丢弃之后的全部轮次；文件保持现状。
   */
  function onRestoreCheckpoint(msg: Extract<ChatMessage, { role: "user" }>): void {
    const id = sessionId;
    if (!id) return;
    const d: DialogHandle = dialog.warning({
      title: t.restoreCheckpoint,
      content: t.restoreCheckpointConfirm,
      positiveText: t.confirm,
      negativeText: t.cancel,
      onPositiveClick: () => {
        d.loading = true;
        return (async () => {
          try {
            const restored = await chat.restoreTurn(id, msg.id);
            if (!restored.ok) {
              messageApi.error(t.restoreCheckpointFail(t.turnMismatch));
              d.loading = false;
              return false;
            }
            messageApi.success(t.restoreCheckpointDone);
            return true;
          } catch (err) {
            messageApi.error(
              t.restoreCheckpointFail(err instanceof Error ? err.message : String(err)),
            );
            d.loading = false;
            return false;
          }
        })();
      },
    });
  }

  /** assistant 行归属到本轮最近的 user 消息，操作行的检查点/派生按钮需要它。 */
  const roundUserByRow = useMemo(() => buildRoundUserByRow(messages), [messages]);

  function roundUserOf(msg: ChatMessage): UserMessage | null {
    return roundUserByRow.get(msg.id) ?? null;
  }

  /** 最后一轮没有可丢弃的后续轮次，还原检查点不适用（文件撤回仍可用）。 */
  function isLatestRound(msg: ChatMessage): boolean {
    return roundUserOf(msg)?.id === rowsRef.current.latestUserMessageId;
  }

  /** 历史轮的助手回答在会话运行中也要显示操作栏；当前轮等本轮结束。 */
  function canShowAssistantActions(msg: ChatMessage): boolean {
    if (msg.role !== "assistant" || msg.streaming || !isFinalAnswer(msg)) return false;
    return !running || !isLatestRound(msg);
  }

  /** VS Code Copilot 的 Fork Conversation：把到本轮为止的对话复制成新会话。 */
  async function onForkConversation(msg: Extract<ChatMessage, { role: "user" }>): Promise<void> {
    const id = sessionId;
    if (!id) return;
    try {
      const forkedId = await chat.forkConversation(id, msg.id);
      if (!forkedId) {
        messageApi.error(t.forkConversationFail(t.turnMismatch));
        return;
      }
      messageApi.success(t.forkConversationDone);
    } catch (err) {
      messageApi.error(
        t.forkConversationFail(err instanceof Error ? err.message : String(err)),
      );
    }
  }

  async function onRegenerate(msg: Extract<ChatMessage, { role: "assistant" }>): Promise<void> {
    const id = sessionId;
    if (!id) return;
    await chat.regenerate(id, msg.id);
  }

  async function onRetryError(msg: Extract<ChatMessage, { role: "error" }>): Promise<void> {
    const id = sessionId;
    if (!id || running) return;
    await chat.retryFromError(id, msg.id);
  }

  function canRevertUser(msg: Extract<ChatMessage, { role: "user" }>): boolean {
    const id = sessionId;
    if (!id) return false;
    // Touch byKey so the view re-renders when checkpoint status flips to ready.
    const s = checkpoints.summaryFor(id, msg.id);
    return s?.status === "ready" && s.fileCount > 0;
  }

  function isRevertedUser(msg: Extract<ChatMessage, { role: "user" }>): boolean {
    const id = sessionId;
    if (!id) return false;
    return checkpoints.summaryFor(id, msg.id)?.status === "reverted";
  }

  function onRevertUser(msg: Extract<ChatMessage, { role: "user" }>): void {
    const id = sessionId;
    if (!id || running) return;
    if (!checkpoints.canRevert(id, msg.id)) return;
    const d: DialogHandle = dialog.warning({
      title: t.revertTurn,
      content: t.revertTurnConfirm,
      positiveText: t.confirm,
      negativeText: t.cancel,
      onPositiveClick: () => {
        d.loading = true;
        return (async () => {
          try {
            const result = await checkpoints.revert(id, msg.id);
            if (!result.ok) {
              messageApi.error(t.revertTurnFail(result.error || "unknown"));
              d.loading = false;
              return false;
            }
            if (result.restored === 0 && result.deleted === 0) {
              messageApi.info(t.revertTurnEmpty);
              return true;
            }
            messageApi.success(t.revertTurnDone(result.restored, result.deleted));
            return true;
          } catch (err) {
            messageApi.error(err instanceof Error ? err.message : String(err));
            d.loading = false;
            return false;
          }
        })();
      },
    });
  }

  /**
   * Messages that are not in the transcript yet, shown as cards at the tail so they
   * never appear to vanish:
   * - `queued`  — waiting for the turn to end before being sent.
   * - `steered` — already handed to the running turn; the agent writes it into the
   *   session only after the current tool calls finish, so it is invisible until then.
   */
  const pendingCards = useMemo(
    () => [
      ...sendQueue.activePendingSteers.map((item) => ({ item, kind: "steered" as const })),
      ...sendQueue.activeItems.map((item) => ({ item, kind: "queued" as const })),
    ],
    [sendQueue.activePendingSteers, sendQueue.activeItems],
  );

  /** One-line preview for a pending card (mirrors SendQueueBar). */
  function queuePreview(item: {
    text: string;
    images?: unknown[];
    elementTags?: { label?: string }[];
  }): string {
    const raw = item.text.replace(/\s+/gu, " ").trim();
    if (raw) return raw;
    if (item.images?.length) return `[${item.images.length} image(s)]`;
    if (item.elementTags?.length) return item.elementTags[0]?.label || "[attachment]";
    return "…";
  }

  /** 清空 pi 侧的引导 / 排队消息与本地队列（丢弃，不退回输入框）。 */
  function clearPendingQueue(): void {
    const id = sessions.activeId;
    if (!id) return;
    const count = pendingCards.length;
    dialog.warning({
      title: t.queueClear,
      content: t.queueClearConfirm(count),
      positiveText: t.queueClear,
      negativeText: t.cancel,
      onPositiveClick: async () => {
        try {
          await chat.clearQueue(id);
          sendQueue.clearSession(id);
          messageApi.success(t.queueCleared);
        } catch (err) {
          messageApi.error(err instanceof Error ? err.message : String(err));
        }
      },
    });
  }

  /**
   * Drop in-flight guidance once it has landed in the transcript, otherwise the card
   * would outlive the message it represents.
   */
  const pendingSteerKey = useMemo(() => {
    const id = sessions.activeId;
    if (!id) return 0;
    const state = chat.bySession[id];
    const last = state?.messages.at(-1);
    return last?.role === "user" ? state.messages.length : 0;
  }, [chat.bySession, sessions.activeId]);

  const prevPendingSteerKey = useRef<{ sessionId: string | null; len: number } | null>(null);
  useEffect(() => {
    const sid = sessions.activeId;
    const len = pendingSteerKey;
    const prev = prevPendingSteerKey.current;
    prevPendingSteerKey.current = { sessionId: sid, len };
    if (!prev || prev.sessionId !== sid) return;
    if (sid && len > prev.len) sendQueue.clearPendingSteers(sid);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在落盘边沿清理，与原实现一致
  }, [pendingSteerKey, sessions.activeId]);

  const waitState = chat.activeWaitState;
  /** Keep status visible during long gaps between stream chunks. */
  const showWaitWhileStreaming = useMemo(() => {
    const s = waitState;
    if (!s) return false;
    return agentOutputSilenceMs(s as ChatState) >= 15_000;
  }, [waitState]);

  /**
   * 尾部提示（排队卡片 / 等待 / 重试）是 .inner 里的非虚拟元素，高度变化不会触发
   * virtua 的 resize；贴底时单独收敛一次，否则它们会被裁在视口外。
   */
  const extUiOpen = Boolean(chat.activePendingExtensionUi);
  const tailMarkers = `${pendingCards.length}:${dockAsk ? 1 : 0}:${extUiOpen ? 1 : 0}:${retryHint ? 1 : 0}:${waitState ? 1 : 0}`;
  useEffect(() => {
    scroll.scheduleBottomScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在尾部提示组合变化时贴底，与原实现一致
  }, [tailMarkers]);

  /** 单行渲染：行高由 virtua 实测，行间距由 .row 的 padding 承担。 */
  function renderMessageRow(msg: ChatMessage, index: number): ReactElement {
    const membership = workSectionMembership.get(msg.id);
    const rowClass = [
      styles.row,
      rowRoleClass(msg.role),
      index === renderRows.length - 1 ? styles.rowLast : "",
      sessionId && chat.isPendingEditTail(sessionId, msg.id)
        ? styles.rowEditTail
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    if (membership) {
      return (
        <article key={msg.id} className={rowClass} data-msg-id={msg.id}>
          <div className={styles.tool}>
            <WorkSectionGroup
              items={membership.items}
              autoCollapse={rowSettled(msg)}
              autoExpand={autoExpandSummary}
              onOpen={openPreview}
            />
          </div>
        </article>
      );
    }
    if (msg.role === "user") {
      const view = userRow(msg);
      return (
        <UserMessageRow
          key={msg.id}
          msg={msg}
          rowClass={rowClass}
          view={view}
          expanded={isUserExpanded(msg.id)}
          overflowing={overflowUserIds.has(msg.id)}
          latest={msg.id === latestUserMessageId}
          latestRead={latestUserRead}
          running={running}
          canRevert={canRevertUser(msg)}
          reverted={isRevertedUser(msg)}
          onCopy={() => void copyText(view.text)}
          onEdit={() => onEditUser(msg)}
          onRevert={() => onRevertUser(msg)}
          onToggleExpand={() => toggleUserExpanded(msg.id)}
          onOverflowChange={markUserOverflow}
          t={t}
        />
      );
    }
    if (msg.role === "assistant") {
      const roundUser = roundUserOf(msg);
      return (
        <AssistantMessageRow
          key={msg.id}
          msg={msg}
          rowClass={rowClass}
          stats={statsByRow.get(msg.id)}
          modelDetail={modelDetailByRow.get(msg.id)}
          diff={turnDiffFor(msg)}
          canShowActions={canShowAssistantActions(msg)}
          isLatestRound={isLatestRound(msg)}
          hasRoundUser={Boolean(roundUser)}
          diffOpen={isTurnDiffOpen(msg.id)}
          autoExpandSummary={autoExpandSummary}
          turnDone={turnDone}
          onCopy={() => void copyText(msg.text)}
          onRegenerate={() => void onRegenerate(msg)}
          onRestore={() => {
            if (roundUser) onRestoreCheckpoint(roundUser);
          }}
          onFork={() => {
            if (roundUser) void onForkConversation(roundUser);
          }}
          onToggleDiff={() => toggleTurnDiff(msg.id)}
          onOpenFile={openPreview}
        />
      );
    }
    if (msg.role === "tool") {
      return (
        <ToolMessageRow
          key={msg.id}
          msg={msg}
          rowClass={rowClass}
          pendingAsk={msg.id === pendingAskRowId}
          card={toolCard(msg)}
          toolName={toolDisplayName(msg.toolName, msg.args, msg.result)}
          status={toolStatus(msg)}
          settled={rowSettled(msg)}
          onOpen={openPreview}
        />
      );
    }
    if (msg.role === "summary") {
      return (
        <SummaryMessageRow
          key={msg.id}
          msg={msg}
          rowClass={rowClass}
          open={isSummaryOpen(msg.id)}
          onToggle={() => toggleSummary(msg.id)}
          t={t}
        />
      );
    }
    return (
      <ErrorMessageRow
        key={msg.id}
        msg={msg}
        rowClass={rowClass}
        running={running}
        onRetry={() => void onRetryError(msg)}
        t={t}
      />
    );
  }

  return (
    <>
      <div className={styles.messageListRoot}>
        <div
          ref={scroll.scrollerRef}
          className={`${styles.messageList}${scroll.settlingUi ? ` ${styles.isSettling}` : ""}`}
        >
          <div ref={scroll.innerRef} className={styles.inner}>
            <scroll.Virtualizer
              as={scroll.VirtualHost}
              data={renderRows}
              scrollRef={scroll.scrollerRef}
              shift={scroll.shift}
              startMargin={scroll.startMargin}
              bufferSize={scroll.overscanPx}
              onResize={scroll.commitBottomScroll}
            >
              {(msg, index) => renderMessageRow(msg, index)}
            </scroll.Virtualizer>

            {dockAsk ? <AskUserStrip /> : null}
            {chat.activePendingExtensionUi ? <ExtensionUiStrip /> : null}

            {scroll.showJumpLatest ? null : (
              <>
                {retryHint ? (
                  <RetryHintRow
                    hint={retryHint}
                    progress={waitState?.llmProgress ?? null}
                    t={t}
                  />
                ) : waitState && (showWaitWhileStreaming || !streaming) ? (
                  <AgentWaitIndicator state={waitState} />
                ) : null}
              </>
            )}

            {/*
              Guidance that is not in the transcript yet. Without this the message
              vanished from the UI the moment it was sent/queued (it only came back as a
              bubble when the agent got to it), which read as "my message was lost".
            */}
            {pendingCards.length ? (
              <div className={styles.steerCards} aria-live="polite">
                {pendingCards.map((row) => (
                  <div key={row.item.id} className={styles.steerCard}>
                    <span className={styles.steerCardTag}>
                      {row.kind === "steered" ? t.steerPendingSent : t.steerPendingTag}
                    </span>
                    <span className={styles.steerCardText}>{queuePreview(row.item)}</span>
                  </div>
                ))}
                <button type="button" className={styles.steerClear} onClick={clearPendingQueue}>
                  {t.queueClear}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {scroll.jumpMounted ? (
          <button
            type="button"
            className={`${styles.jumpLatest} ${styles.jumpLatestMotion} pi-interactive ${scroll.jumpEntered ? styles.jumpLatestVisible : styles.jumpLatestHidden}`}
            title={t.scrollToLatest}
            aria-label={t.scrollToLatest}
            onClick={scroll.jumpToLatest}
          >
            <ArrowDownOutline size={16} />
            <span>{t.scrollToLatest}</span>
          </button>
        ) : null}
      </div>
    </>
  );
}

export default MessageList;

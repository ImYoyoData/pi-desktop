import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { Button, Empty, Tag, Tooltip, Typography } from "antd";
import {
  ArrowDownOutline,
  ArrowUndoOutline,
  ChevronDownOutline,
  ChevronForwardOutline,
  ChevronUpOutline,
  CopyOutline,
  CreateOutline,
  GitBranchOutline,
  RefreshOutline,
} from "@renderer/components/icons/ionicons";
import type { ChatMessage, ChatRetryHint } from "@renderer/stores/chat";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { useChatStore } from "@renderer/stores/chat";
import { useCheckpointStore } from "@renderer/stores/checkpoint";
import { useComposerStore } from "@renderer/stores/composer";
import { useSendQueueStore } from "@renderer/stores/send-queue";
import { useSessionsStore } from "@renderer/stores/sessions";
import ThinkingBlock from "@renderer/components/ThinkingBlock";
import ToolCallCard from "@renderer/components/ToolCallCard";
import TurnDiffSummary from "@renderer/components/TurnDiffSummary";
import WorkSectionGroup from "@renderer/components/WorkSectionGroup";
import AgentWaitIndicator from "@renderer/components/AgentWaitIndicator";
import ImageLightbox from "@renderer/components/ImageLightbox";
import { toolCardFor as toolCard } from "@renderer/utils/tool-diff";
import {
  buildFinalAnswerIds,
  buildRoundUserByRow,
  buildSettledRowIds,
  buildWorkSectionMembership,
  displayMessageRows,
  lastIdPerRound,
  latestTurnStartIndex,
  type UserMessage,
} from "@renderer/utils/message-rows";
import { agentOutputSilenceMs } from "@renderer/utils/agent-wait";
import type { ChatState } from "@renderer/stores/chat-reducer";
import { usePreviewStore } from "@renderer/stores/preview";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useI18n } from "@renderer/i18n/use-i18n";
import {
  useDialog,
  useMessage,
  type DialogHandle,
} from "@renderer/services/feedback";
import { buildUserRowView, type UserRowView } from "@renderer/utils/message-user";
import { planComposerTags } from "@renderer/utils/composer-payload";
import {
  collectTurnFileChanges,
  type TurnFileChanges,
} from "@renderer/utils/turn-file-changes";
import { decideFollowOnScroll } from "@renderer/utils/follow-bottom";
import {
  allowWindowAdjust,
  createWindowAdjustGate,
  noteWindowAdjust,
  trimLineIsSafe,
  type WindowAdjustDir,
} from "@renderer/utils/message-virtual-window";
import {
  assistantModelDetail as assistantModelDetailOf,
  assistantStats as assistantStatsOf,
  buildModelNameMap,
  toolStatus as toolStatusOf,
  type CompactDetail,
  type ToolMessage,
  type ToolStatusLabel,
} from "@renderer/utils/message-metrics";
import styles from "./MessageList.module.css";

/**
 * Markdown rendering pulls katex / marked / highlight.js — load it lazily
 * so opening a session with many messages stays responsive on slow CPUs.
 */
const MarkdownView = lazy(() => import("@renderer/components/MarkdownView"));

/**
 * Sliding virtual window: mount a modest range around the viewport so
 * opening a long shared Pi session stays interactive (overscan above + below).
 */
const VIRTUAL_WINDOW = 32;
/** Soft cap before trimming the far side of the window. */
const VIRTUAL_MAX = 48;
const VIRTUAL_CHUNK = 16;
const EST_MSG_HEIGHT = 120;
/** Collapsed tool-group summary row (Cursor-style). */
const EST_TOOL_GROUP_HEIGHT = 40;
const NEAR_BOTTOM_PX = 120;
/**
 * Prefetch distance to spacers. Keep modest — large overscan + recursive expand
 * remounted Markdown/tool rows and froze the whole Electron UI while dragging.
 */
const OVERSCAN_PX = 280;
/** Sticky user card must never cover the whole viewport (agent output would look "stuck"). */
const STICKY_MAX_VH = 0.16;
const STICKY_MAX_PX = 110;

type Props = {
  messages: ChatMessage[];
  streaming: ChatMessage | null;
  running: boolean;
  retryHint?: ChatRetryHint | null;
  historyLoading?: boolean;
  /** 面板被折叠/让位给编辑器区域时为 false。 */
  visible?: boolean;
};

type RenderWindow = { start: number; end: number };

type ScrollAnchor = { id: string; viewportTop: number };
type ScrollAnchors = { first: ScrollAnchor | null; last: ScrollAnchor | null };

type ImagePreview = { dataUrl: string; mimeType: string };

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
  const chat = useChatStore();
  const checkpoints = useCheckpointStore();
  const composer = useComposerStore();
  const sendQueue = useSendQueueStore();
  const sessions = useSessionsStore();
  const previewStore = usePreviewStore();
  const rightTabs = useRightTabsStore();
  const appearance = useAppearanceStore();
  const messageApi = useMessage();
  const dialog = useDialog();

  /** 面板不可见时内容会被跳过渲染，任何读量高都会强制布局，必须停掉追踪。 */
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  function paneHidden(): boolean {
    return visibleRef.current === false;
  }

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const historyLoadingRef = useRef(historyLoading);
  historyLoadingRef.current = historyLoading;
  const lastPinnedUserId = useRef<string | null>(null);
  /** Avoid follow-bottom immediately undoing the post-send card-bottom scroll. */
  const suppressFollowBottomUntil = useRef(0);
  /** Inclusive start / exclusive end of displayMessages currently mounted. */
  const windowRef = useRef<RenderWindow>({ start: 0, end: 0 });
  const [renderWindow, setRenderWindow] = useState<RenderWindow>(windowRef.current);
  /**
   * 测量表容量上限。key 带会话前缀以免不同会话互相污染，但表本身不会在切换
   * 会话时清理 —— 长时间使用 / 频繁切会话会让它涨到几十万条，之后每次查表
   * 都变成缓存未命中。按插入顺序淘汰最旧的即可：被淘汰的行重新挂载时量一次。
   */
  const MEASURE_MAX_ENTRIES = 20_000;
  const heightById = useRef(new Map<string, number>());
  /** Heights are session-scoped: switching sessions keeps past measurements usable. */
  function heightKey(id: string): string {
    return `${sessions.activeId}|${id}`;
  }
  /** Real layout offsetTop of measured rows (for accurate sticky pinning). */
  const topById = useRef(new Map<string, number>());
  function rememberMeasure(cache: Map<string, number>, key: string, value: number): void {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > MEASURE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
  const adjustingWindow = useRef(false);
  /**
   * 窗口调整方向闸门：向上扩展裁尾部、向下扩展裁头部，两侧裁剪会互相把对方
   * 重新推回阈值内，形成每帧交替重建 DOM 的自激振荡。反向调整必须隔一帧以上，
   * 短时间内反复反向则判定为振荡，拉长冷却。同向连续扩展不受影响。
   * 判据与状态机在 utils/message-virtual-window.ts。
   */
  const adjustGate = useRef(createWindowAdjustGate(Date.now()));

  function allowAdjust(dir: WindowAdjustDir): boolean {
    return allowWindowAdjust(adjustGate.current, dir, Date.now());
  }

  function noteAdjust(dir: WindowAdjustDir): void {
    adjustGate.current = noteWindowAdjust(adjustGate.current, dir, Date.now());
  }

  const followBottom = useRef(true);
  /**
   * Latched once the user scrolls away from the live edge; cleared only when they
   * scroll back down into the near-bottom zone (or send / jump-to-latest). A pure
   * distance threshold deadlocks while streaming: every chunk snap re-bottoms the
   * viewport, so `isNearBottom` stays true and small upward wheel steps could
   * never escape it.
   */
  const userScrolledAway = useRef(false);
  /**
   * Hard latch: the user is reading history and may be away from the live edge —
   * absolutely no viewport motion until they ask for it. Guards every watcher /
   * mutation that would otherwise snap back to the bottom while the agent keeps
   * streaming or while older pages keep loading.
   */
  const readingHistory = useRef(false);
  /** Session switch / hydrate settle — snap to bottom, never smooth-scroll. */
  const settlingSession = useRef(false);
  const sessionJumpToken = useRef(0);
  /** Template flag: hide list until first bottom snap (avoids blank spacer flash). */
  const [settlingUi, setSettlingUi] = useState(false);
  /** Show floating jump control when user scrolled away from latest. */
  const [showJumpLatest, setShowJumpLatest] = useState(false);
  const scrollRaf = useRef(0);

  /**
   * VS Code Copilot design (chatThinkingContentPart): the latest turn's process
   * — every tool call and thinking row between answer texts — stays in the
   * stream, folded per work section (see WorkSectionGroup). Older turns drop
   * their process rows so history reads as prompts + final answers only.
   */
  /** 完整消息序列（含 streaming）：改动统计需要历史轮被裁剪掉的工具行。 */
  const allMessages = useMemo<ChatMessage[]>(() => {
    const list = [...messages];
    if (streaming) list.push(streaming);
    return list;
  }, [messages, streaming]);

  /**
   * 渲染行序列。最新一轮之前的工具 / 纯思考行不渲染，历史只留用户提问与最终回答
   * （Codex 风格）；行整形、分组、折叠判定的规则在 utils/message-rows.ts。
   */
  const displayMessages = useMemo(
    () => displayMessageRows(allMessages, latestTurnStartIndex(messages)),
    [allMessages, messages],
  );

  const workSectionMembership = useMemo(
    () => buildWorkSectionMembership(displayMessages),
    [displayMessages],
  );

  const settledRowIds = useMemo(
    () => buildSettledRowIds(displayMessages, workSectionMembership),
    [displayMessages, workSectionMembership],
  );

  const finalAnswerIds = useMemo(
    () => buildFinalAnswerIds(displayMessages),
    [displayMessages],
  );

  const latestUserMessageId = useMemo(() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      const m = displayMessages[i];
      if (m?.role === "user") return m.id;
    }
    return null;
  }, [displayMessages]);

  const rowsRef = useRef({
    displayMessages,
    workSectionMembership,
    settledRowIds,
    finalAnswerIds,
    latestUserMessageId,
  });
  rowsRef.current = {
    displayMessages,
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

  const visibleMessages = displayMessages.slice(renderWindow.start, renderWindow.end);

  /** 更早历史的分页游标；没有更早历史时不显示入口。 */
  const olderState = useMemo(() => {
    const id = sessions.activeId;
    if (!id) return null;
    return chat.olderBySession[id] ?? null;
  }, [chat.olderBySession, sessions.activeId]);

  function applyWindow(next: RenderWindow): void {
    windowRef.current = next;
    setRenderWindow(next);
  }

  /**
   * 前插一页更早历史，并把渲染窗口同步下移同样条数。
   *
   * 前插只会让已挂载行的下标整体后移；窗口同步平移后可见集合不变，顶部占位
   * （estimateRangeHeight(0, renderStart)）相应变高，视口因此不会跳动。
   */
  async function onLoadOlder(): Promise<void> {
    const id = sessions.activeId;
    if (!id) return;
    const added = await chat.loadOlderMessages(id);
    if (added <= 0 || sessions.activeId !== id) return;
    const len = rowsRef.current.displayMessages.length;
    const current = windowRef.current;
    applyWindow({
      start: Math.min(current.start + added, len),
      end: Math.min(current.end + added, len),
    });
  }

  function estimateMessageHeight(msg: ChatMessage | undefined): number {
    if (!msg) return EST_MSG_HEIGHT;
    const group = rowsRef.current.workSectionMembership.get(msg.id);
    if (group) {
      if (!group.isLead) return 0;
      return heightById.current.get(heightKey(group.leadId)) || EST_TOOL_GROUP_HEIGHT;
    }
    return heightById.current.get(heightKey(msg.id)) || EST_MSG_HEIGHT;
  }

  function estimateRangeHeight(from: number, to: number): number {
    const all = rowsRef.current.displayMessages;
    let h = 0;
    for (let i = from; i < to; i++) {
      h += estimateMessageHeight(all[i]);
    }
    return h;
  }

  /**
   * 第 index 行的真实顶部位置（相对滚动内容，与 scrollTop 同坐标系）。
   * 裁剪线判断必须用它：spacer 用的是估算高度，估算误差会把裁剪线算进视口里，
   * 裁掉的行随即又被下一次扩展挂回来 —— 上下交替重建 DOM 正是“滚到中段必卡”的根因。
   * 折叠跟随行 display:none，offsetTop 恒为 0，改用上一行的底部推算。
   * 返回 null 表示窗口内没有可用的实测值，调用方退回估算。
   */
  function measuredBoundaryTop(index: number): number | null {
    const all = rowsRef.current.displayMessages;
    const own = topById.current.get(all[index]?.id ?? "");
    if (own != null && own > 0) return own;
    for (let i = index - 1; i >= windowRef.current.start; i--) {
      const id = all[i]?.id;
      if (!id) continue;
      const top = topById.current.get(id);
      const h = heightById.current.get(heightKey(id));
      if (top != null && top > 0 && h != null && h > 0) return top + h;
    }
    return null;
  }

  const topSpacerPx = useMemo(
    () => estimateRangeHeight(0, renderWindow.start),
    [displayMessages, renderWindow.start],
  );

  const bottomSpacerPx = useMemo(
    () => estimateRangeHeight(renderWindow.end, displayMessages.length),
    [displayMessages, renderWindow.end],
  );

  const spacerRef = useRef({ topSpacerPx, bottomSpacerPx });
  spacerRef.current = { topSpacerPx, bottomSpacerPx };

  /**
   * Below this estimated total height the whole list mounts without a trailing
   * window: a windowed head would render as blank spacer (and drop the opening
   * user prompt from view) even though everything would fit on screen.
   */
  const FULL_MOUNT_MAX_PX = 2000;

  function fitsFullMount(len: number): boolean {
    return len <= VIRTUAL_WINDOW || estimateRangeHeight(0, len) <= FULL_MOUNT_MAX_PX;
  }

  const sessionId = sessions.activeId;

  /**
   * Cursor-like sticky user prompt:
   * Among user messages scrolled fully above the viewport, pin the nearest
   * (highest index). Overlay uses store text — no need to remount that row.
   */
  const [stickyExpanded, setStickyExpanded] = useState(false);
  const [stickyNeedsToggle, setStickyNeedsToggle] = useState(false);
  const [stickyHover, setStickyHover] = useState(false);
  const [stickyPinId, setStickyPinId] = useState<string | null>(null);
  const stickyPinEl = useRef<HTMLDivElement | null>(null);

  /** User cards the user explicitly expanded (id → true). Default: collapsed. */
  const [expandedUserIds, setExpandedUserIds] = useState<Set<string>>(new Set());

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

  const stickyPinned = stickyPinId != null;

  const stickyPinMessage = useMemo(() => {
    if (!stickyPinId) return null;
    const msg = displayMessages.find((m) => m.id === stickyPinId);
    return msg?.role === "user" ? msg : null;
  }, [displayMessages, stickyPinId]);

  /** 置顶预览条：关闭预览、或内容全被开关隐藏（如纯图片消息）时不显示。 */
  const stickyPreview = useMemo<{ msg: UserMessage; view: UserRowView } | null>(() => {
    if (!appearance.showMessagePreview) return null;
    const msg = stickyPinMessage;
    if (!msg) return null;
    const view = buildUserRowView(msg);
    const hasImages = (msg.images?.length ?? 0) > 0 && appearance.showMessagePreviewImage;
    return hasImages || view.text || view.tags.length > 0 ? { msg, view } : null;
  }, [appearance.showMessagePreview, appearance.showMessagePreviewImage, stickyPinMessage]);

  function stickyCapPx(sc: HTMLElement): number {
    return Math.min(Math.round(sc.clientHeight * STICKY_MAX_VH), STICKY_MAX_PX);
  }

  function measureStickyNeedsToggle(naturalHeight: number): void {
    const sc = scrollerRef.current;
    if (!sc || !stickyPinned) {
      setStickyNeedsToggle(false);
      return;
    }
    setStickyNeedsToggle(naturalHeight > stickyCapPx(sc) + 12);
  }

  /**
   * Nearest user message fully above the viewport top (Cursor behavior).
   * Uses real measured layout offsets when available (the estimate used to
   * over-count the user card height, pinning messages that had only partially
   * scrolled out of view). Unmounted rows above the window never render (the
   * spacer is blank), so the nearest user message up there is always pinnable.
   */
  function findStickyUserMessageId(): string | null {
    const sc = scrollerRef.current;
    const all = rowsRef.current.displayMessages;
    if (!sc || all.length === 0) return null;

    const viewportTop = sc.scrollTop + 8;

    for (let i = all.length - 1; i >= 0; i--) {
      const m = all[i]!;
      if (m.role !== "user") continue;
      if (i < windowRef.current.start) return m.id;
      const top = topById.current.get(m.id);
      if (top == null) continue;
      // Real position: pin only when the WHOLE row is above the viewport;
      // otherwise keep scanning upward for an older fully-scrolled-out prompt.
      if (top + estimateMessageHeight(m) < viewportTop) return m.id;
    }

    return null;
  }

  function clearStickyPin(): void {
    if (!stickyPinId && !stickyNeedsToggle) return;
    setStickyPinId(null);
    setStickyExpanded(false);
    setStickyHover(false);
    setStickyNeedsToggle(false);
  }

  /** Pin overlay for the nearest user message scrolled above the viewport. */
  function updateStickyPinned(): void {
    const sc = scrollerRef.current;
    if (!sc || !appearance.showMessagePreview) {
      clearStickyPin();
      return;
    }

    const id = findStickyUserMessageId();
    if (!id) {
      clearStickyPin();
      return;
    }

    if (id !== stickyPinId) {
      setStickyPinId(id);
      setStickyExpanded(false);
      setStickyHover(false);
    }

    // Sticky UI is an overlay copy from store — do NOT expand the virtual window
    // to remount that row (that previously caused unbounded mounts + nextTick loops).
    const body = stickyPinEl.current?.querySelector<HTMLElement>(".sticky-pin-body");
    if (body) {
      measureStickyNeedsToggle(body.scrollHeight);
      return;
    }
    requestAnimationFrame(() => {
      const el = stickyPinEl.current?.querySelector<HTMLElement>(".sticky-pin-body");
      if (el) measureStickyNeedsToggle(el.scrollHeight);
    });
  }

  function refreshStickyToggleNeed(): void {
    requestAnimationFrame(() => {
      if (!stickyPinned) {
        setStickyNeedsToggle(false);
        return;
      }
      const pin = stickyPinEl.current;
      const body = pin?.querySelector<HTMLElement>(".sticky-pin-body");
      if (body) {
        measureStickyNeedsToggle(body.scrollHeight);
        return;
      }
      updateStickyPinned();
    });
  }

  function toggleStickyExpanded(): void {
    setStickyExpanded((current) => !current);
    refreshStickyToggleNeed();
  }

  function onStickyUserEnter(): void {
    if (!stickyPinned) return;
    setStickyHover(true);
    refreshStickyToggleNeed();
  }

  function onStickyUserLeave(): void {
    setStickyHover(false);
  }

  function isNearBottom(el: HTMLElement): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }

  /**
   * A work section renders only on its lead row — a window that starts inside a
   * group would mount followers as empty 0-height rows. Widen the start upward
   * to the group's lead so the section stays whole.
   */
  function groupAlignedStart(start: number, end: number): number {
    const all = rowsRef.current.displayMessages;
    if (start <= 0 || start >= all.length || start >= end) return start;
    const m = rowsRef.current.workSectionMembership.get(all[start]!.id);
    if (!m) return start;
    const leadIdx = all.findIndex((r) => r.id === m.leadId);
    return leadIdx >= 0 && leadIdx < start ? leadIdx : start;
  }

  function alignRenderWindowToGroup(start: number, end: number): void {
    const len = rowsRef.current.displayMessages.length;
    const clampedEnd = Math.max(0, Math.min(end, len));
    const clampedStart = groupAlignedStart(Math.max(0, Math.min(start, clampedEnd)), clampedEnd);
    applyWindow({ start: clampedStart, end: clampedEnd });
  }

  /**
   * 贴底窗口：从尾部向上累加估算高度，直到能盖住视口（至少 VIRTUAL_WINDOW 行）。
   * 长摘要折叠后尾部只剩一行表头，固定行数的尾窗会让视口落进顶部 spacer，
   * 看起来就是一大片空白。
   */
  function tailWindowForViewport(len: number): { start: number; end: number } {
    const all = rowsRef.current.displayMessages;
    const need = (scrollerRef.current?.clientHeight ?? 0) + OVERSCAN_PX;
    const minStart = Math.max(0, len - VIRTUAL_WINDOW);
    let start = minStart;
    let height = 0;
    for (let i = len - 1; i >= 0; i--) {
      height += estimateMessageHeight(all[i]);
      if (height >= need && i <= minStart) {
        start = i;
        break;
      }
      if (i === 0) {
        start = 0;
        break;
      }
    }
    return { start: groupAlignedStart(start, len), end: len };
  }

  function clampRenderWindow(preferBottom: boolean): void {
    const len = rowsRef.current.displayMessages.length;
    // Mount-all only while pinned to the bottom (callers re-pin after the
    // clamp); expanding mid-read has no scroll compensation and would jump.
    if (preferBottom && fitsFullMount(len)) {
      applyWindow({ start: 0, end: len });
      return;
    }
    if (len <= VIRTUAL_WINDOW) {
      applyWindow({ start: 0, end: len });
      return;
    }
    if (preferBottom) {
      const tail = tailWindowForViewport(len);
      alignRenderWindowToGroup(tail.start, tail.end);
      return;
    }
    // Keep current window sized and clamped inside [0, len].
    const current = windowRef.current;
    let start = Math.max(0, Math.min(current.start, len));
    let end = Math.max(start, Math.min(current.end, len));
    if (end - start < Math.min(VIRTUAL_WINDOW, len)) {
      end = Math.min(len, start + VIRTUAL_WINDOW);
      start = Math.max(0, end - VIRTUAL_WINDOW);
    }
    alignRenderWindowToGroup(start, end);
  }

  function measureVisibleRows(): void {
    const sc = scrollerRef.current;
    if (!sc || paneHidden()) return;
    const rows = sc.querySelectorAll<HTMLElement>(".row[data-msg-id]");
    for (const row of rows) {
      const id = row.dataset.msgId;
      if (!id) continue;
      // Use layout height for virtual window estimates.
      const h = row.offsetHeight;
      if (h > 0) rememberMeasure(heightById.current, heightKey(id), h);
      // Real layout offset inside the scroller (rows are flex children of .inner).
      const top = row.offsetTop;
      if (top > 0 || row === rows[0]) rememberMeasure(topById.current, id, top);
    }
  }

  /**
   * Re-measure a single row after its own content resized (e.g. a work section
   * finished its fold/unfold animation). Keeps virtual-window heights in sync
   * without a full relayout — the source of the "janky" fold.
   * 拖动分隔条 / 缩放窗口时每帧会收到多个分组的高度变化，按帧合并成一次测量。
   */
  const resizedRowRaf = useRef(0);
  const resizedRowIds = useRef(new Set<string>());
  function rowResized(id: string): void {
    if (adjustingWindow.current || settlingSession.current || paneHidden()) return;
    resizedRowIds.current.add(id);
    if (resizedRowRaf.current) return;
    resizedRowRaf.current = requestAnimationFrame(() => {
      resizedRowRaf.current = 0;
      const ids = [...resizedRowIds.current];
      resizedRowIds.current.clear();
      const sc = scrollerRef.current;
      if (!sc) return;
      for (const rowId of ids) {
        const row = sc.querySelector<HTMLElement>(`.row[data-msg-id="${rowId}"]`);
        if (!row) continue;
        const h = row.offsetHeight;
        if (h > 0) rememberMeasure(heightById.current, heightKey(rowId), h);
        const top = row.offsetTop;
        if (top > 0) rememberMeasure(topById.current, rowId, top);
      }
      ensureViewportCovered();
    });
  }

  /**
   * 行高变化（长摘要折叠/展开）后视口可能落进 spacer 覆盖的未挂载区域 ——
   * 屏幕上就只剩一片空白。这里就地补挂对应方向的行，让视口重新被真实内容盖住。
   */
  function ensureViewportCovered(): void {
    if (adjustingWindow.current || settlingSession.current || document.hidden) return;
    if (paneHidden()) return;
    const sc = scrollerRef.current;
    if (!sc) return;
    // 已挂载内容不足一屏且确实有 spacer：行高可能在被卸载期间变化过，先量一次再判断。
    const mountedHeight = sc.scrollHeight - spacerRef.current.topSpacerPx - spacerRef.current.bottomSpacerPx;
    if (
      mountedHeight < sc.clientHeight &&
      (spacerRef.current.topSpacerPx > 0 || spacerRef.current.bottomSpacerPx > 0)
    ) {
      measureVisibleRows();
    }
    if (
      windowRef.current.start > 0 &&
      sc.scrollTop < spacerRef.current.topSpacerPx + OVERSCAN_PX
    ) {
      expandHistoryUp();
      return;
    }
    const len = rowsRef.current.displayMessages.length;
    if (
      windowRef.current.end < len &&
      sc.scrollTop + sc.clientHeight > sc.scrollHeight - spacerRef.current.bottomSpacerPx - OVERSCAN_PX
    ) {
      expandHistoryDown();
    }
  }

  const viewportCoverRaf = useRef(0);
  /**
   * 视口补挂必须走 rAF：expandHistoryUp/Down 的 nextTick 末尾若直接同步调
   * ensureViewportCovered，扩展会在同一个宏任务的微任务链里一路递归到
   * renderStart===0 / renderEnd===len —— 期间浏览器既不出帧也不派发输入，
   * 整段历史被挂成真实 DOM，窗口彻底无响应。改由下一帧续跑，每帧最多扩一轮。
   */
  function scheduleViewportCover(): void {
    if (viewportCoverRaf.current) return;
    viewportCoverRaf.current = requestAnimationFrame(() => {
      viewportCoverRaf.current = 0;
      ensureViewportCovered();
    });
  }

  /** 视口内首/尾两条可见行，作为窗口变更后的位置基准。 */
  function captureScrollAnchors(): ScrollAnchors {
    const anchors: ScrollAnchors = { first: null, last: null };
    const sc = scrollerRef.current;
    if (!sc) return anchors;
    const scRect = sc.getBoundingClientRect();
    for (const row of sc.querySelectorAll<HTMLElement>(".row[data-msg-id]")) {
      const id = row.dataset.msgId;
      if (!id) continue;
      const rect = row.getBoundingClientRect();
      if (rect.bottom <= scRect.top || rect.top >= scRect.bottom) continue;
      const anchor = { id, viewportTop: rect.top - scRect.top };
      if (!anchors.first) anchors.first = anchor;
      anchors.last = anchor;
    }
    return anchors;
  }

  /**
   * 窗口变更后把锚点行放回原视口位置，按行的真实位移补偿。
   * 不能用整体高度差：它把窗口内其它行的内容变化（流式输出、异步 Markdown）
   * 和 spacer 估算误差一并算进去，等于每次调整都把视图往底部推。
   * 向上扩展裁尾部、向下扩展裁头部，所以首/尾锚点至少有一个还在。
   */
  function restoreScrollAnchor(
    anchors: ScrollAnchors,
    prevHeight: number,
    prevTop: number,
  ): void {
    const sc = scrollerRef.current;
    if (!sc) return;
    const scTop = sc.getBoundingClientRect().top;
    for (const anchor of [anchors.first, anchors.last]) {
      if (!anchor) continue;
      const row = sc.querySelector<HTMLElement>(
        `.row[data-msg-id="${CSS.escape(anchor.id)}"]`,
      );
      if (!row) continue;
      sc.scrollTop += row.getBoundingClientRect().top - scTop - anchor.viewportTop;
      return;
    }
    // 两个锚点都被卸载时退回高度差补偿。
    sc.scrollTop = prevTop + (sc.scrollHeight - prevHeight);
  }

  /** After a window mutate, continue prefetch on the next frame (yields to paint — no nextTick storm). */
  function scheduleWindowPrefetch(): void {
    requestAnimationFrame(() => {
      const sc = scrollerRef.current;
      if (!sc || adjustingWindow.current || settlingSession.current) return;
      if (
        windowRef.current.start > 0 &&
        sc.scrollTop < spacerRef.current.topSpacerPx + OVERSCAN_PX
      ) {
        expandHistoryUp();
        return;
      }
      if (followBottom.current) return;
      const bottomEdge = sc.scrollHeight - spacerRef.current.bottomSpacerPx;
      if (sc.scrollTop + sc.clientHeight > bottomEdge - OVERSCAN_PX) {
        expandHistoryDown();
      }
    });
  }

  function expandHistoryUp(): void {
    if (adjustingWindow.current) return;
    if (windowRef.current.start <= 0) return;
    if (!allowAdjust("up")) return;
    const sc = scrollerRef.current;
    if (!sc) return;
    adjustingWindow.current = true;
    const prevHeight = sc.scrollHeight;
    const prevTop = sc.scrollTop;
    const anchor = captureScrollAnchors();
    const nextStart = Math.max(0, windowRef.current.start - VIRTUAL_CHUNK);
    let nextEnd = windowRef.current.end;
    // Trim far (bottom) side so mounting stays bounded while scrolling up.
    // 被裁掉的行必须在视口下方，否则底部 spacer 会顶进视口（露出空白）。
    const trimEnd = nextStart + VIRTUAL_MAX;
    if (!followBottom.current && trimEnd < nextEnd) {
      const viewportTop = sc.scrollTop;
      const viewportBottom = sc.scrollTop + sc.clientHeight;
      const trimLineTop = measuredBoundaryTop(trimEnd);
      if (trimLineTop != null) {
        // 实测裁剪线：它在视口下方留够 OVERSCAN_PX，裁完就不会立刻满足向下扩展条件。
        if (
          trimLineIsSafe({
            dir: "up",
            trimLineTop,
            viewportTop,
            viewportBottom,
            overscanPx: OVERSCAN_PX,
          })
        ) {
          nextEnd = trimEnd;
        }
      } else {
        const trimmed = estimateRangeHeight(trimEnd, nextEnd);
        const trimTop = sc.scrollHeight - spacerRef.current.bottomSpacerPx - trimmed;
        // 余量要含被裁区间的估算高度：估算偏低会让 trimTop 偏大，只留 OVERSCAN_PX
        // 会裁到视口内的行（锚点随之丢失，scrollTop 突跳又触发新一轮调整）。
        if (
          trimLineIsSafe({
            dir: "up",
            trimLineTop: trimTop,
            viewportTop,
            viewportBottom,
            overscanPx: OVERSCAN_PX,
            margin: trimmed,
          })
        ) {
          nextEnd = trimEnd;
        }
      }
    }
    const len = rowsRef.current.displayMessages.length;
    if (fitsFullMount(len)) {
      flushSync(() => applyWindow({ start: 0, end: len }));
    } else {
      const start = groupAlignedStart(nextStart, nextEnd);
      flushSync(() =>
        applyWindow({
          start: Math.max(0, Math.min(start, len)),
          end: Math.max(0, Math.min(nextEnd, len)),
        }),
      );
    }
    noteAdjust("up");
    restoreScrollAnchor(anchor, prevHeight, prevTop);
    measureVisibleRows();
    adjustingWindow.current = false;
    updateStickyPinned();
    scheduleWindowPrefetch();
    scheduleViewportCover();
  }

  function expandHistoryDown(): void {
    if (adjustingWindow.current) return;
    const len = rowsRef.current.displayMessages.length;
    if (windowRef.current.end >= len) return;
    if (!allowAdjust("down")) return;
    const sc = scrollerRef.current;
    if (!sc) return;
    adjustingWindow.current = true;
    const prevHeight = sc.scrollHeight;
    const prevTop = sc.scrollTop;
    const anchor = captureScrollAnchors();
    const nextEnd = Math.min(len, windowRef.current.end + VIRTUAL_CHUNK);
    // Trim far (top) side — never grow past VIRTUAL_MAX (sticky is overlay-only).
    // 被裁掉的行必须完全在视口上方，否则顶部 spacer 会露进视口（“到最顶上大片空白”）。
    let nextStart = windowRef.current.start;
    const trimStart = nextEnd - VIRTUAL_MAX;
    if (trimStart > nextStart) {
      const viewportTop = sc.scrollTop;
      const viewportBottom = sc.scrollTop + sc.clientHeight;
      const trimLineTop = measuredBoundaryTop(trimStart);
      if (trimLineTop != null) {
        // 实测裁剪线：它在视口上方留够 OVERSCAN_PX，裁完就不会立刻满足向上扩展条件。
        if (
          trimLineIsSafe({
            dir: "down",
            trimLineTop,
            viewportTop,
            viewportBottom,
            overscanPx: OVERSCAN_PX,
          })
        ) {
          nextStart = trimStart;
        }
      } else {
        const trimmed = estimateRangeHeight(nextStart, trimStart);
        const trimBottom = spacerRef.current.topSpacerPx + trimmed;
        // 同上：topSpacerPx / 估算高度偏低会让 trimBottom 偏小，条件反而更容易成立。
        if (
          trimLineIsSafe({
            dir: "down",
            trimLineTop: trimBottom,
            viewportTop,
            viewportBottom,
            overscanPx: OVERSCAN_PX,
            margin: trimmed,
          })
        ) {
          nextStart = trimStart;
        }
      }
    }
    if (fitsFullMount(len)) {
      flushSync(() => applyWindow({ start: 0, end: len }));
    } else {
      const start = groupAlignedStart(nextStart, nextEnd);
      flushSync(() =>
        applyWindow({
          start: Math.max(0, Math.min(start, len)),
          end: Math.max(0, Math.min(nextEnd, len)),
        }),
      );
    }
    noteAdjust("down");
    restoreScrollAnchor(anchor, prevHeight, prevTop);
    measureVisibleRows();
    adjustingWindow.current = false;
    updateStickyPinned();
    scheduleWindowPrefetch();
    scheduleViewportCover();
  }

  const instantSnapToken = useRef(0);
  function jumpToBottomInstant(): void {
    // Jump control / settle are the only callers; anything else must not move
    // the viewport while the user is reading history.
    if (readingHistory.current || paneHidden()) return;
    const sc = scrollerRef.current;
    if (!sc) return;
    const token = ++instantSnapToken.current;
    sc.scrollTop = sc.scrollHeight;
    // Deferred re-snaps must re-check follow: the user may scroll up while these
    // rAFs are still queued — never yank the viewport back down afterwards.
    requestAnimationFrame(() => {
      if (token !== instantSnapToken.current || (!followBottom.current && !settlingSession.current)) {
        return;
      }
      if (readingHistory.current) return;
      const el = scrollerRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => {
        if (token !== instantSnapToken.current || (!followBottom.current && !settlingSession.current)) {
          return;
        }
        if (readingHistory.current) return;
        const el2 = scrollerRef.current;
        if (el2) el2.scrollTop = el2.scrollHeight;
      });
    });
  }

  /**
   * Coalesced follow-bottom scroll for streaming updates. Forcing layout three
   * times per tool_execution_update (immediate + two rAF re-sets) starved the UI
   * thread while bash/write output streamed. One scrollTop set per animation
   * frame is enough; later updates simply re-schedule.
   */
  const bottomScrollRaf = useRef(0);
  /**
   * 每 tick 同步量高会强制布局（offsetHeight 读取），高 chunk 频率下占满主线程。
   * 流式期间合并为 ~250ms 尾随测量，滚动 / 窗口调整路径仍各自即时测量。
   */
  const streamMeasureTimer = useRef(0);
  function scheduleStreamMeasure(): void {
    if (streamMeasureTimer.current) return;
    streamMeasureTimer.current = window.setTimeout(() => {
      streamMeasureTimer.current = 0;
      measureVisibleRows();
    }, 250);
  }
  function scheduleBottomScroll(): void {
    // Hard latch first: a reader must never be yanked, even if followBottom is
    // still momentarily true in a state snapshot taken mid-wheel.
    if (readingHistory.current) return;
    // Minimized / hidden: no layout work until the window is restored.
    if (document.hidden || paneHidden()) return;
    if (bottomScrollRaf.current) return;
    bottomScrollRaf.current = requestAnimationFrame(() => {
      bottomScrollRaf.current = 0;
      const sc = scrollerRef.current;
      // Re-check at fire time, not just schedule time: the user may have scrolled
      // up after the snap was queued (the follow decision is sync, this rAF is
      // not) — never yank the viewport back down while they read history.
      if (!sc || document.hidden || paneHidden() || !followBottom.current) return;
      // Even when a prior state sample left follow=true (samples are not atomic
      // with a mid-await wheel), the hard reading latch still wins at fire time.
      if (readingHistory.current) return;
      sc.scrollTop = sc.scrollHeight;
    });
  }

  /** 面板 / 窗口重新可见：贴底收敛一次，不重新量全部行高。 */
  function onBecameVisible(): void {
    if (paneHidden() || document.hidden) return;
    if (!followBottom.current || readingHistory.current) return;
    clampRenderWindow(true);
    scheduleBottomScroll();
    requestAnimationFrame(() => {
      measureVisibleRows();
      scheduleBottomScroll();
    });
  }

  /** Restored from minimized: land at the live edge without a big re-measure. */
  function onVisibilityChange(): void {
    if (document.hidden) return;
    onBecameVisible();
  }

  const prevVisible = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const prev = prevVisible.current;
    prevVisible.current = visible;
    if (prev === undefined) return;
    if (visible !== false) onBecameVisible();
  }, [visible]);

  function jumpToLatest(): void {
    disengageHistoryReading();
    setShowJumpLatest(false);
    clampRenderWindow(true);
    requestAnimationFrame(() => {
      measureVisibleRows();
      jumpToBottomInstant();
    });
  }

  /** Bottom snap for session settle / post-hydrate; guards follow + settle + latch. */
  function snapSessionToBottom(token: number): void {
    if (token !== sessionJumpToken.current) return;
    if (settlingSession.current) {
      // settle state is being snapped anyway — do NOT reset a mid-settle latch.
      clampRenderWindow(true);
      lastPinnedUserId.current = rowsRef.current.latestUserMessageId;
      return;
    }
    // historyLoading finished outside settle (hydrate landed late): jump to live.
    if (!followBottom.current && !readingHistory.current) {
      disengageHistoryReading();
      clampRenderWindow(true);
      lastPinnedUserId.current = rowsRef.current.latestUserMessageId;
    }
    jumpToBottomInstant();
    updateStickyPinned();
    refreshStickyToggleNeed();
  }

  /** Cold start + session switch: wait for hydrate, then land on bottom (no blank spacer). */
  async function beginSessionSettle(): Promise<void> {
    const token = ++sessionJumpToken.current;
    settlingSession.current = true;
    setSettlingUi(true);
    disengageHistoryReading();
    applyWindow({ start: 0, end: 0 });

    // History load is async after activeId flips — wait for messages / load end before revealing.
    const deadline = Date.now() + 8_000;
    while (token === sessionJumpToken.current && Date.now() < deadline) {
      const stillLoading = Boolean(historyLoadingRef.current);
      if (!stillLoading) {
        // Allow one frame for hydrate to land after loading clears.
        await new Promise<void>((r) => setTimeout(r, 16));
        break;
      }
      await new Promise<void>((r) => setTimeout(r, 40));
    }
    if (token !== sessionJumpToken.current) return;

    // An empty list after the hydrate frame is final (brand-new session) — don't
    // burn the old 400ms empty-poll on every fresh chat.
    if (rowsRef.current.displayMessages.length === 0) {
      const emptyDeadline = Date.now() + 120;
      while (
        token === sessionJumpToken.current &&
        rowsRef.current.displayMessages.length === 0 &&
        Date.now() < emptyDeadline
      ) {
        await new Promise<void>((r) => setTimeout(r, 40));
      }
    }
    if (token !== sessionJumpToken.current) return;

    await snapSessionToBottom(token);
    // Land on the bottom BEFORE revealing (the old flow revealed only after all
    // re-snaps; with early reveal the stale scroll offset would flash otherwise).
    if (token === sessionJumpToken.current) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      jumpToBottomInstant();
      setSettlingUi(false);
    }
    for (const waitMs of [0, 50, 120, 280, 600]) {
      if (waitMs) await new Promise<void>((r) => setTimeout(r, waitMs));
      if (token !== sessionJumpToken.current) return;
      await snapSessionToBottom(token);
    }
    if (token === sessionJumpToken.current) {
      settlingSession.current = false;
      // Final snap after reveal (layout may change when visibility returns).
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      jumpToBottomInstant();
    }
  }

  /**
   * Cheap, synchronous follow-bottom decision on every scroll event. Must NOT be
   * rAF-deferred: stream snaps are themselves scheduled on rAFs, so deferring
   * this let an already-queued snap run with a stale followBottom=true and yank
   * the viewport back to the bottom while the user was reading history above.
   */
  const lastSyncScrollTop = useRef(-1);
  function cancelQueuedBottomSnaps(): void {
    if (bottomScrollRaf.current) {
      cancelAnimationFrame(bottomScrollRaf.current);
      bottomScrollRaf.current = 0;
    }
    // Invalidate instant-snap rAF chains queued before the user scrolled away.
    instantSnapToken.current++;
  }

  /** 用户明确开始读历史：立即脱离贴底，不再被任何排队中的贴底拉回。 */
  function engageUserHistoryScroll(): void {
    if (readingHistory.current && !followBottom.current) return;
    const sc = scrollerRef.current;
    if (!sc || sc.scrollHeight <= sc.clientHeight + 1) return;
    cancelSessionSettle();
    suppressFollowBottomUntil.current = 0;
    userScrolledAway.current = true;
    followBottom.current = false;
    cancelQueuedBottomSnaps();
    engageHistoryReading();
  }

  /** 会话贴底是多段异步快照，用户中途上滑时整体取消。 */
  function cancelSessionSettle(): void {
    if (!settlingSession.current) return;
    sessionJumpToken.current++;
    settlingSession.current = false;
    setSettlingUi(false);
  }

  function syncFollowBottomOnScroll(sc: HTMLElement): void {
    // While the virtual window adjusts the DOM, scroll events are synthetic — the
    // decision machine must not run at all (a synthetic nudge could otherwise
    // look like the user scrolling back down).
    if (adjustingWindow.current || settlingSession.current) {
      lastSyncScrollTop.current = sc.scrollTop;
      return;
    }
    const decision = decideFollowOnScroll({
      top: sc.scrollTop,
      lastTop: lastSyncScrollTop.current,
      nearBottom: isNearBottom(sc),
      now: Date.now(),
      suppressUntil: suppressFollowBottomUntil.current,
      away: userScrolledAway.current,
      following: followBottom.current,
      guarded: false,
    });
    lastSyncScrollTop.current = sc.scrollTop;
    userScrolledAway.current = decision.away;
    suppressFollowBottomUntil.current = decision.suppressUntil;
    followBottom.current = decision.following;
    if (!followBottom.current) cancelQueuedBottomSnaps();
    // While a user is reading history (hard latch), every extra list insert
    // shifts the DOM; synthetic scroll events then fire. Those are not
    // intent — the state machine stays inert except for a real return into the
    // live edge, which releases the latch (decideFollowOnScroll only reports
    // following=true once the user scrolls back into the near-bottom zone).
    if (readingHistory.current) {
      if (!decision.following) {
        setShowJumpLatest(rowsRef.current.displayMessages.length > 0);
        return;
      }
      disengageHistoryReading();
    }
    // Return to the live edge = explicit "stop reading history" intent.
    if (!followBottom.current) engageHistoryReading();
    setShowJumpLatest(!followBottom.current && rowsRef.current.displayMessages.length > 0);
  }

  /**
   * Wheel events only fire for real user input (programmatic scrollTop writes do
   * not). One upward tick disengages follow immediately — even inside the
   * near-bottom threshold, where stream snaps would otherwise keep resetting the
   * user's scroll progress every chunk and they could never escape.
   */
  function onScrollerWheel(event: WheelEvent): void {
    if (event.deltaY >= 0) return;
    if (!scrollerRef.current) return;
    engageUserHistoryScroll();
  }

  function onScrollerKeydown(event: KeyboardEvent): void {
    if (event.key !== "ArrowUp" && event.key !== "PageUp" && event.key !== "Home") return;
    engageUserHistoryScroll();
  }

  const touchStartY = useRef(-1);
  function onScrollerTouchStart(event: TouchEvent): void {
    touchStartY.current = event.touches[0]?.clientY ?? -1;
  }

  /** 手指下移 = 内容上滚 = 回看更早的消息（触摸屏 / 手机网页端没有 wheel 事件）。 */
  function onScrollerTouchMove(event: TouchEvent): void {
    const y = event.touches[0]?.clientY;
    if (y == null || touchStartY.current < 0 || y <= touchStartY.current + 8) return;
    engageUserHistoryScroll();
  }

  /** 指针落在滚动条区域（元素内容区右侧）时同样视为主动滚动。 */
  function onScrollerPointerDown(event: PointerEvent): void {
    const sc = scrollerRef.current;
    if (!sc) return;
    if (event.clientX < sc.getBoundingClientRect().left + sc.clientWidth) return;
    engageUserHistoryScroll();
  }

  /** Heavy virtual-window / prefetch work stays rAF-coalesced (follow already synced). */
  function handleScrollerScroll(): void {
    const sc = scrollerRef.current;
    if (!sc || adjustingWindow.current || settlingSession.current) return;

    if (followBottom.current) {
      const len = rowsRef.current.displayMessages.length;
      const ideal = fitsFullMount(len) ? { start: 0, end: len } : tailWindowForViewport(len);
      if (windowRef.current.start !== ideal.start || windowRef.current.end !== ideal.end) {
        alignRenderWindowToGroup(ideal.start, ideal.end);
        // The clamp changes content above the live edge — re-pin so the
        // viewport stays on the bottom instead of sliding into the spacer.
        requestAnimationFrame(() => {
          const el = scrollerRef.current;
          if (!el || !followBottom.current || readingHistory.current || adjustingWindow.current) {
            return;
          }
          el.scrollTop = el.scrollHeight;
          measureVisibleRows();
          ensureViewportCovered();
        });
      } else {
        ensureViewportCovered();
      }
      return;
    }

    // Prefetch above: expand before the viewport hits blank spacer.
    if (
      windowRef.current.start > 0 &&
      sc.scrollTop < spacerRef.current.topSpacerPx + OVERSCAN_PX
    ) {
      expandHistoryUp();
    }
    // Prefetch below: keep continuity when scrolling back toward latest.
    const bottomEdge = sc.scrollHeight - spacerRef.current.bottomSpacerPx;
    if (sc.scrollTop + sc.clientHeight > bottomEdge - OVERSCAN_PX) {
      expandHistoryDown();
    }
  }

  function onScrollerScroll(): void {
    if (paneHidden()) return;
    const sc = scrollerRef.current;
    if (sc) syncFollowBottomOnScroll(sc);
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0;
      handleScrollerScroll();
      updateStickyPinned();
    });
  }

  function engageHistoryReading(): void {
    readingHistory.current = true;
    setShowJumpLatest(true);
  }

  function disengageHistoryReading(): void {
    readingHistory.current = false;
    followBottom.current = true;
    userScrolledAway.current = false;
    lastSyncScrollTop.current = -1;
  }

  const latestHandlers = useRef({
    onScrollerScroll,
    onScrollerWheel,
    onScrollerKeydown,
    onScrollerTouchStart,
    onScrollerTouchMove,
    onScrollerPointerDown,
  });
  latestHandlers.current = {
    onScrollerScroll,
    onScrollerWheel,
    onScrollerKeydown,
    onScrollerTouchStart,
    onScrollerTouchMove,
    onScrollerPointerDown,
  };

  useEffect(() => {
    const sc = scrollerRef.current;
    if (!sc) return;
    const onScroll = (): void => latestHandlers.current.onScrollerScroll();
    const onWheel = (event: WheelEvent): void =>
      latestHandlers.current.onScrollerWheel(event);
    const onKeydown = (event: KeyboardEvent): void =>
      latestHandlers.current.onScrollerKeydown(event);
    const onTouchStart = (event: TouchEvent): void =>
      latestHandlers.current.onScrollerTouchStart(event);
    const onTouchMove = (event: TouchEvent): void =>
      latestHandlers.current.onScrollerTouchMove(event);
    const onPointerDown = (event: PointerEvent): void =>
      latestHandlers.current.onScrollerPointerDown(event);
    sc.addEventListener("scroll", onScroll, { passive: true });
    sc.addEventListener("wheel", onWheel, { passive: true });
    sc.addEventListener("keydown", onKeydown);
    sc.addEventListener("touchstart", onTouchStart, { passive: true });
    sc.addEventListener("touchmove", onTouchMove, { passive: true });
    sc.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    // Auto-load on startup mounts MessageList *after* activeId is set, so the
    // sessionId watcher may not re-fire — settle here or the spacer looks blank.
    void beginSessionSettle();
    void loadModelNames();
    return () => {
      sc.removeEventListener("scroll", onScroll);
      sc.removeEventListener("wheel", onWheel);
      sc.removeEventListener("keydown", onKeydown);
      sc.removeEventListener("touchstart", onTouchStart);
      sc.removeEventListener("touchmove", onTouchMove);
      sc.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (scrollRaf.current) {
        cancelAnimationFrame(scrollRaf.current);
        scrollRaf.current = 0;
      }
      if (viewportCoverRaf.current) {
        cancelAnimationFrame(viewportCoverRaf.current);
        viewportCoverRaf.current = 0;
      }
      if (bottomScrollRaf.current) {
        cancelAnimationFrame(bottomScrollRaf.current);
        bottomScrollRaf.current = 0;
      }
      if (streamMeasureTimer.current) {
        clearTimeout(streamMeasureTimer.current);
        streamMeasureTimer.current = 0;
      }
      if (resizedRowRaf.current) {
        cancelAnimationFrame(resizedRowRaf.current);
        resizedRowRaf.current = 0;
      }
      resizedRowIds.current.clear();
      instantSnapToken.current++;
    };
  }, []);

  const prevSessionId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevSessionId.current;
    prevSessionId.current = sessionId;
    if (prev === undefined) return;
    disengageHistoryReading();
    void beginSessionSettle();
  }, [sessionId]);

  const prevHistoryLoading = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const wasLoading = prevHistoryLoading.current;
    prevHistoryLoading.current = historyLoading;
    if (wasLoading === undefined) return;
    // History finished while settling — snap immediately (don't wait for poll tick).
    if (wasLoading && !historyLoading && settlingSession.current) {
      void snapSessionToBottom(sessionJumpToken.current);
    }
  }, [historyLoading]);

  const prevDisplayLength = useRef<number | undefined>(undefined);
  useEffect(() => {
    const len = rowsRef.current.displayMessages.length;
    const prevLen = prevDisplayLength.current;
    prevDisplayLength.current = len;
    const hydratedFromEmpty = (prevLen === 0 || prevLen == null) && len > 0;
    // Only pin the trailing window when the user is following the bottom.
    // (Do NOT yank the window during agent runs if the user scrolled up to read history.)
    if (readingHistory.current) {
      // List growth above the anchored read position is fine — the spacer
      // absorbs it and the browser keeps the anchored row on screen.
      if (!hydratedFromEmpty) clampRenderWindow(false);
    } else if (followBottom.current || hydratedFromEmpty) {
      clampRenderWindow(true);
    } else if (len <= VIRTUAL_WINDOW) {
      applyWindow({ start: 0, end: len });
    } else {
      clampRenderWindow(false);
    }
    // Critical: hydrate often lands AFTER settle timeouts. Always snap when
    // following bottom / first populate, otherwise the virtual spacer stays in view (blank).
    // Skip while hidden — the visibility handler re-snaps once on restore.
    if (
      (followBottom.current || settlingSession.current || hydratedFromEmpty) &&
      !document.hidden &&
      !readingHistory.current
    ) {
      lastPinnedUserId.current = rowsRef.current.latestUserMessageId;
      setShowJumpLatest(false);
      requestAnimationFrame(() => {
        // User may have scrolled up while this tick was queued — respect it.
        if (!followBottom.current && !settlingSession.current && !hydratedFromEmpty) return;
        jumpToBottomInstant();
      });
    }
  }, [displayMessages.length]);

  /** Hydrate can replace history with the same length — still need a bottom snap. */
  const prevLastMessageId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const id = messages.at(-1)?.id ?? null;
    const prev = prevLastMessageId.current;
    prevLastMessageId.current = id;
    if (prev === undefined) return;
    if (!id || id === prev) return;
    if (readingHistory.current) return;
    // A *new* trailing message while already following: just re-clamp + snap.
    if (followBottom.current) {
      clampRenderWindow(true);
      lastPinnedUserId.current = rowsRef.current.latestUserMessageId;
      requestAnimationFrame(() => {
        if (!followBottom.current && !settlingSession.current) return;
        jumpToBottomInstant();
      });
    } else if (!settlingSession.current) {
      // hydrate landed late (settle already finished) — snap now.
      snapSessionToBottom(sessionJumpToken.current);
    }
  }, [messages]);

  /** When a new latest user message appears (send / re-edit send): leave room for agent. */
  const prevLatestUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const id = rowsRef.current.latestUserMessageId;
    const prev = prevLatestUserId.current;
    prevLatestUserId.current = id;
    if (prev === undefined) return;
    setStickyExpanded(false);
    setStickyHover(false);
    setStickyNeedsToggle(false);
    setStickyPinId(null);
    if (!id || id === lastPinnedUserId.current) {
      updateStickyPinned();
      refreshStickyToggleNeed();
      return;
    }
    const prevReading = readingHistory.current;
    lastPinnedUserId.current = id;
    if (prevReading) {
      // While the user was reading history and sends a follow-up, follow them
      // down to the new tail — jump immediately, don't wait for settle logic.
      disengageHistoryReading();
      clampRenderWindow(true);
      suppressFollowBottomUntil.current = Date.now() + 160;
      requestAnimationFrame(() => {
        measureVisibleRows();
        updateStickyPinned();
        refreshStickyToggleNeed();
        const sc = scrollerRef.current;
        const card = sc?.querySelector(`[data-msg-id="${CSS.escape(id)}"]`) as HTMLElement | null;
        if (!sc || !card) return;
        const scRect = sc.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const top = cardRect.bottom - scRect.top + sc.scrollTop - sc.clientHeight + 8;
        sc.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      });
      return;
    }
    // Session switch / hydrate: land on bottom instantly (no slide).
    disengageHistoryReading();
    clampRenderWindow(true);
    if (settlingSession.current) {
      requestAnimationFrame(() => {
        jumpToBottomInstant();
        updateStickyPinned();
        refreshStickyToggleNeed();
      });
      return;
    }
    // Brief pause so follow-bottom doesn't yank away before layout settles.
    suppressFollowBottomUntil.current = Date.now() + 160;
    requestAnimationFrame(() => {
      measureVisibleRows();
      updateStickyPinned();
      refreshStickyToggleNeed();
      const sc2 = scrollerRef.current;
      const card2 = sc2?.querySelector(
        `[data-msg-id="${CSS.escape(id)}"]`,
      ) as HTMLElement | null;
      if (!sc2 || !card2) return;
      // Show the end of the full prompt (no height clamp until actually pinned).
      const scRect2 = sc2.getBoundingClientRect();
      const cardRect2 = card2.getBoundingClientRect();
      const top2 = cardRect2.bottom - scRect2.top + sc2.scrollTop - sc2.clientHeight + 8;
      sc2.scrollTo({ top: Math.max(0, top2), behavior: "smooth" });
    });
  }, [rowsRef.current.latestUserMessageId]);

  const prevStreamRun = useRef<{
    length: number;
    streaming: ChatMessage | null;
    running: boolean;
  } | null>(null);

  useEffect(() => {
    const prev = prevStreamRun.current;
    prevStreamRun.current = { length: messages.length, streaming, running };
    if (!prev) return;
    if (Date.now() < suppressFollowBottomUntil.current) return;
    if (document.hidden || readingHistory.current) return;
    const prevStreaming = prev.streaming ?? null;
    const prevRunning = prev.running ?? false;
    const justFinished = Boolean(prevRunning || prevStreaming) && !running && !streaming;
    // Follow while generating; also snap once when the turn settles (actions
    // mount) — but never yank a user who scrolled up to read history.
    if (running || streaming || justFinished) {
      if (!followBottom.current) return;
      // Coalesced + re-checked at fire time (never yanks a scrolled-up reader).
      scheduleBottomScroll();
      if (justFinished) measureVisibleRows();
      else scheduleStreamMeasure();
      if (justFinished) {
        requestAnimationFrame(() => {
          const sc = scrollerRef.current;
          if (sc && followBottom.current && !readingHistory.current) sc.scrollTop = sc.scrollHeight;
        });
      }
    }
  }, [messages.length, streaming, running]);

  const lastStreamToolId = useRef("");
  const lastStreamArgs = useRef<unknown>(undefined);
  const lastStreamResult = useRef<unknown>(undefined);
  const prevStreamIdentity = useRef<string | undefined>(undefined);
  useEffect(() => {
    const s = streaming;
    let identity: string;
    if (!s) {
      identity = "";
    } else if (s.role === "assistant") {
      lastStreamToolId.current = "";
      lastStreamArgs.current = undefined;
      lastStreamResult.current = undefined;
      identity = `a:${s.thinking?.length ?? 0}:${s.text?.length ?? 0}`;
    } else if (s.role === "tool") {
      // Every streamed update replaces the args/result objects, so identity is
      // enough — avoids JSON.stringify(args/result) on every chunk (O(output)
      // stringify per tick while a bash/write tool streams).
      const changed =
        s.id !== lastStreamToolId.current ||
        s.args !== lastStreamArgs.current ||
        s.result !== lastStreamResult.current;
      lastStreamToolId.current = s.id;
      lastStreamArgs.current = s.args;
      lastStreamResult.current = s.result;
      identity = `t:${s.id}:${changed ? "1" : "0"}`;
    } else {
      lastStreamToolId.current = "";
      lastStreamArgs.current = undefined;
      lastStreamResult.current = undefined;
      identity = s.id;
    }
    const prev = prevStreamIdentity.current;
    prevStreamIdentity.current = identity;
    if (prev === undefined) return;
    if (!followBottom.current || Date.now() < suppressFollowBottomUntil.current) return;
    if (!running && !streaming) return;
    if (document.hidden || readingHistory.current) return;
    requestAnimationFrame(() => {
      scheduleBottomScroll();
    });
  }, [streaming]);

  /**
   * The current round finished (nothing streaming and nothing running): fold all
   * process rows (tools + thinking) so only the user question and final answer
   * stay prominent, Codex-style. Users can still re-expand any row manually.
   */
  const turnDone = !running && !streaming;

  /**
   * opencode DiffSummary：每轮（user 行分隔）的文件改动汇总，挂在轮末最终回答
   * 下方。统计用完整消息 — 历史轮的工具行在渲染时被裁剪，计数仍要算上它们。
   */
  const turnDiffsByRow = useMemo(() => {
    const out = new Map<string, TurnFileChanges>();
    const stats = collectTurnFileChanges(allMessages, toolCard, turnDone);
    if (!stats.size) return out;
    const sourceIds = lastIdPerRound(allMessages, (msg) => msg.role !== "user");
    const answerIds = lastIdPerRound(
      displayMessages,
      (msg) => msg.role === "assistant" && Boolean(msg.text),
    );
    for (let i = 0; i < sourceIds.length; i++) {
      const sourceId = sourceIds[i];
      const rowId = answerIds[i];
      const changes = sourceId ? stats.get(sourceId) : undefined;
      if (changes && rowId) out.set(rowId, changes);
    }
    return out;
  }, [allMessages, displayMessages, turnDone]);

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
    for (const msg of displayMessages) {
      if (msg.role === "user") out.set(msg.id, buildUserRowView(msg));
    }
    return out;
  }, [displayMessages]);

  function userRow(msg: ChatMessage): UserRowView {
    const view = userViewByRow.get(msg.id);
    if (view) return view;
    return msg.role === "user"
      ? buildUserRowView(msg)
      : { text: "", tags: [], needsToggle: false };
  }

  function openPreview(filePath: string): void {
    previewStore.openPreview(filePath);
    rightTabs.addTab("preview", {
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

  /**
   * 尾部指标只在最终回答行渲染，预先算成表：模板里直接查表，
   * 避免每行每次渲染重复做 toLocaleString / 思考级别映射。单遍 O(n)。
   */
  const statsByRow = useMemo(() => {
    const out = new Map<string, CompactDetail | null>();
    for (const msg of displayMessages) {
      if (msg.role === "assistant" && finalAnswerIds.has(msg.id)) {
        out.set(msg.id, assistantStatsOf(msg));
      }
    }
    return out;
  }, [displayMessages, finalAnswerIds]);

  const modelDetailByRow = useMemo(() => {
    const out = new Map<string, CompactDetail | null>();
    const usage = sessions.activeContextUsage;
    for (const msg of displayMessages) {
      if (msg.role === "assistant" && finalAnswerIds.has(msg.id)) {
        out.set(msg.id, assistantModelDetailOf(msg, usage, modelNames));
      }
    }
    return out;
  }, [displayMessages, finalAnswerIds, modelNames, sessions.activeContextUsage]);

  async function copyText(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
    messageApi.success(t.copied);
  }

  /** 把一条 user 气泡放回输入框（重新编辑或还原检查点后用）。 */
  function loadComposerFromUser(msg: UserMessage): void {
    const view = buildUserRowView(msg);
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
    if (!id || running) return;
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
  function queuePreview(item: { text: string; images?: unknown[]; elementTags?: { label?: string }[] }): string {
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

  const prevPendingSteerKey = useRef<number | undefined>(undefined);
  useEffect(() => {
    const len = pendingSteerKey;
    const prev = prevPendingSteerKey.current;
    prevPendingSteerKey.current = len;
    if (prev === undefined) return;
    if (len > 0 && sessions.activeId) sendQueue.clearPendingSteers(sessions.activeId);
  }, [pendingSteerKey, sessions.activeId]);

  const waitState = chat.activeWaitState;
  /** Keep status visible during long gaps between stream chunks. */
  const showWaitWhileStreaming = useMemo(() => {
    const s = waitState;
    if (!s) return false;
    return agentOutputSilenceMs(s as ChatState) >= 15_000;
  }, [waitState]);

  /** 当前放大的图片；灯箱本身的交互与样式都在 ImageLightbox 里。 */
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null);

  function openImagePreview(img: ImagePreview): void {
    setImagePreview({ dataUrl: img.dataUrl, mimeType: img.mimeType });
  }

  function closeImagePreview(): void {
    setImagePreview(null);
  }

  const jumpVisible = showJumpLatest && !settlingUi && !historyLoading;
  const [jumpMounted, setJumpMounted] = useState(false);
  const [jumpEntered, setJumpEntered] = useState(false);
  useEffect(() => {
    if (jumpVisible) {
      setJumpMounted(true);
      const raf = requestAnimationFrame(() => setJumpEntered(true));
      return () => cancelAnimationFrame(raf);
    }
    setJumpEntered(false);
    const timer = setTimeout(() => setJumpMounted(false), 200);
    return () => clearTimeout(timer);
  }, [jumpVisible]);

  return (
    <>
      <div className={styles.messageListRoot}>
      <div
        ref={scrollerRef}
        className={`${styles.messageList}${settlingUi ? ` ${styles.isSettling}` : ""}`}
      >
        <div className={styles.inner}>
          {olderState?.hasMore ? (
            <div className={styles.loadOlder}>
              <Button type="text" loading={olderState.loading} onClick={onLoadOlder}>
                {t.loadOlderHistory}
              </Button>
            </div>
          ) : null}

          {messages.length === 0 && !streaming && !historyLoading && !settlingUi ? (
            <Empty description={t.emptyChat} style={{ margin: "auto" }} />
          ) : null}

          {topSpacerPx > 0 ? (
            <div
              className={styles.virtualSpacer}
              style={{ height: `${topSpacerPx}px` }}
              aria-hidden="true"
            />
          ) : null}

          {visibleMessages.map((msg) => {
            const membership = workSectionMembership.get(msg.id);
            const rowClass = [
              styles.row,
              rowRoleClass(msg.role),
              membership?.isLead === false ? styles.rowToolGroupFollower : "",
              sessionId && chat.isPendingEditTail(sessionId, msg.id)
                ? styles.rowEditTail
                : "",
            ]
              .filter(Boolean)
              .join(" ");
            if (membership?.isLead) {
              return (
                <article key={msg.id} className={rowClass} data-msg-id={msg.id}>
                  <div className={styles.tool}>
                    <WorkSectionGroup
                      items={membership.items}
                      autoCollapse={rowSettled(msg)}
                      onOpen={openPreview}
                      onResize={() => rowResized(msg.id)}
                    />
                  </div>
                </article>
              );
            }
            if (membership) {
              return (
                <article key={msg.id} className={rowClass} data-msg-id={msg.id} />
              );
            }
            if (msg.role === "user") {
              const view = userRow(msg);
              const expanded = isUserExpanded(msg.id);
              return (
                <article key={msg.id} className={rowClass} data-msg-id={msg.id}>
                  <div className={`${styles.bubbleWrap} ${styles.user}`}>
                    <div className={`${styles.bubble} ${styles.user}`}>
                      {msg.images?.length ? (
                        <div className={styles.userImages}>
                          {msg.images.map((img, idx) => (
                            <img
                              key={`${msg.id}-img-${idx}`}
                              className={styles.userImage}
                              src={img.dataUrl}
                              alt={t.imageAttachment}
                              loading="lazy"
                              draggable="false"
                              onClick={(event) => {
                                event.stopPropagation();
                                openImagePreview(img);
                              }}
                            />
                          ))}
                        </div>
                      ) : null}
                      {view.text ? (
                        <div
                          className={`${styles.userPlain}${expanded ? "" : ` ${styles.clamped}`}`}
                        >
                          {view.text}
                        </div>
                      ) : null}
                      {view.tags.length ? (
                        <div className={styles.userTags}>
                          {view.tags.map((tag, idx) => (
                            <Tag
                              key={`${msg.id}-tag-${idx}`}
                              color="blue"
                              className={`${styles.userTag}${tag.kind === "file" ? ` ${styles.userTagFile}` : ""}`}
                              title={tag.url || tag.label}
                            >
                              {tag.label || tag.content}
                            </Tag>
                          ))}
                        </div>
                      ) : null}
                      {canRevertUser(msg) || isRevertedUser(msg) ? (
                        <div className={styles.userBubbleFooter}>
                          <Tooltip
                            title={isRevertedUser(msg) ? t.reverted : t.revertTurn}
                            placement="top"
                          >
                            <button
                              type="button"
                              className={styles.bubbleRevert}
                              disabled={running || isRevertedUser(msg)}
                              aria-label={isRevertedUser(msg) ? t.reverted : t.revertTurn}
                              onClick={(event) => {
                                event.stopPropagation();
                                onRevertUser(msg);
                              }}
                            >
                              <ArrowUndoOutline size={15} />
                            </button>
                          </Tooltip>
                        </div>
                      ) : null}
                      {view.needsToggle ? (
                        <button
                          type="button"
                          className={styles.userCardToggle}
                          aria-expanded={expanded}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleUserExpanded(msg.id);
                          }}
                        >
                          {expanded ? (
                            <ChevronUpOutline size={13} />
                          ) : (
                            <ChevronDownOutline size={13} />
                          )}
                          <span>{expanded ? t.userCardCollapse : t.userCardExpand}</span>
                        </button>
                      ) : null}
                    </div>
                    {!running ? (
                      <div className={`${styles.actions} ${styles.userActions}`}>
                        <Tooltip title={t.copy}>
                          <Button
                            type="text"
                            shape="circle"
                            size="small"
                            icon={<CopyOutline />}
                            onClick={() => copyText(view.text)}
                          />
                        </Tooltip>
                        <Tooltip title={t.reEdit}>
                          <Button
                            type="text"
                            shape="circle"
                            size="small"
                            icon={<CreateOutline />}
                            onClick={() => onEditUser(msg)}
                          />
                        </Tooltip>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            }
            if (msg.role === "assistant") {
              const stats = statsByRow.get(msg.id);
              const modelDetail = modelDetailByRow.get(msg.id);
              const roundUser = roundUserOf(msg);
              const diff = turnDiffFor(msg);
              return (
                <article key={msg.id} className={rowClass} data-msg-id={msg.id}>
                  {msg.text || msg.thinking || !msg.streaming ? (
                    <div className={`${styles.bubbleWrap} ${styles.assistant}`}>
                      <div
                        className={`${styles.bubble} ${styles.assistant}${
                          msg.streaming && msg.thinking && !msg.text
                            ? ` ${styles.thinkBottom}`
                            : ""
                        }`}
                      >
                        {msg.thinking || (msg.streaming && !msg.text) ? (
                          <ThinkingBlock
                            thinking={msg.thinking ?? ""}
                            streaming={Boolean(msg.streaming && !msg.text)}
                            autoCollapse={turnDone || !(msg.streaming && !msg.text)}
                          />
                        ) : null}
                        {msg.text ? (
                          <Suspense fallback={null}>
                            <MarkdownView
                              content={msg.text}
                              streaming={Boolean(msg.streaming)}
                              variant="chat"
                              className={`assistant-md${msg.streaming && msg.text ? ` ${styles.streamShimmer}` : ""}`}
                            />
                          </Suspense>
                        ) : null}
                        {msg.streaming && msg.text ? (
                          <span className={styles.cursor} aria-hidden="true" />
                        ) : null}
                      </div>
                      {canShowAssistantActions(msg) ? (
                        <div className={styles.actions}>
                          <Tooltip title={t.copy}>
                            <Button
                              type="text"
                              shape="circle"
                              size="small"
                              icon={<CopyOutline />}
                              onClick={() => copyText(msg.text)}
                            />
                          </Tooltip>
                          <Tooltip title={t.regenerate}>
                            <Button
                              type="text"
                              shape="circle"
                              size="small"
                              icon={<RefreshOutline />}
                              onClick={() => void onRegenerate(msg)}
                            />
                          </Tooltip>
                          {roundUser ? (
                            <>
                              {!isLatestRound(msg) ? (
                                <Tooltip title={t.restoreCheckpoint}>
                                  <Button
                                    type="text"
                                    shape="circle"
                                    size="small"
                                    icon={<ArrowUndoOutline />}
                                    onClick={() => onRestoreCheckpoint(roundUser)}
                                  />
                                </Tooltip>
                              ) : null}
                              <Tooltip title={t.forkConversation}>
                                <Button
                                  type="text"
                                  shape="circle"
                                  size="small"
                                  icon={<GitBranchOutline />}
                                  onClick={() => void onForkConversation(roundUser)}
                                />
                              </Tooltip>
                            </>
                          ) : null}
                          {stats ? (
                            <span className={styles.assistantStats} title={stats.detail}>
                              {stats.compact}
                            </span>
                          ) : null}
                          {modelDetail ? (
                            <span className={styles.assistantModel} title={modelDetail.detail}>
                              {modelDetail.compact}
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      {diff ? (
                        <TurnDiffSummary
                          changes={diff}
                          open={isTurnDiffOpen(msg.id)}
                          onToggle={() => toggleTurnDiff(msg.id)}
                          onOpenFile={openPreview}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            }
            if (msg.role === "tool") {
              const status = toolStatus(msg);
              return (
                <article key={msg.id} className={rowClass} data-msg-id={msg.id}>
                  <div className={styles.tool}>
                    <ToolCallCard
                      card={toolCard(msg)}
                      toolName={msg.toolName}
                      order={msg.order}
                      statusLabel={status.label}
                      statusType={status.type}
                      streaming={msg.streaming}
                      autoCollapse={rowSettled(msg)}
                      nestedCalls={msg.nestedCalls}
                      onOpen={openPreview}
                    />
                  </div>
                </article>
              );
            }
            if (msg.role === "summary") {
              const open = isSummaryOpen(msg.id);
              return (
                <article key={msg.id} className={rowClass} data-msg-id={msg.id}>
                  <div className={styles.summaryCard}>
                    <button
                      className={styles.summaryHead}
                      type="button"
                      onClick={() => toggleSummary(msg.id)}
                    >
                      {open ? <ChevronDownOutline /> : <ChevronForwardOutline />}
                      <span className={styles.summaryTitle}>
                        {msg.kind === "compaction" ? t.summaryCompaction : t.summaryBranch}
                      </span>
                      {msg.tokensBefore ? (
                        <span className={styles.summaryMeta}>
                          {t.summaryTokens(msg.tokensBefore)}
                        </span>
                      ) : null}
                    </button>
                    {open ? <div className={styles.summaryBody}>{msg.text}</div> : null}
                  </div>
                </article>
              );
            }
            const cancelled = msg.variant === "cancelled";
            return (
              <article key={msg.id} className={rowClass} data-msg-id={msg.id}>
                <div
                  className={`${styles.bubbleWrap} ${cancelled ? styles.cancelledWrap : styles.errorWrap}`}
                >
                  <div
                    className={`${styles.bubble} ${cancelled ? styles.cancelled : styles.error}`}
                  >
                    {msg.text}
                  </div>
                  <Button
                    size="small"
                    type={cancelled ? "text" : "primary"}
                    danger={!cancelled}
                    disabled={running}
                    className={styles.errorRetryBtn}
                    icon={<RefreshOutline />}
                    onClick={() => void onRetryError(msg)}
                  >
                    {t.retryRequest}
                  </Button>
                </div>
              </article>
            );
          })}

          {bottomSpacerPx > 0 ? (
            <div
              className={styles.virtualSpacer}
              style={{ height: `${bottomSpacerPx}px` }}
              aria-hidden="true"
            />
          ) : null}

          {renderWindow.end >= displayMessages.length ? (
            <>
              {retryHint ? (
                <div className={styles.runningIndicator}>
                  <span className={`${styles.dot} ${styles.warn}`} />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t.retrying(retryHint.attempt, retryHint.maxAttempts)}
                    {retryHint.message ? (
                      <span className={styles.retryDetail}> · {retryHint.message}</span>
                    ) : null}
                  </Typography.Text>
                </div>
              ) : waitState && (showWaitWhileStreaming || !streaming) ? (
                <AgentWaitIndicator state={waitState} />
              ) : null}
            </>
          ) : null}

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

      {stickyPreview ? (
        <div
          ref={stickyPinEl}
          className={`${styles.userStickyPin}${stickyExpanded ? ` ${styles.isExpanded}` : ""}`}
          onMouseEnter={onStickyUserEnter}
          onMouseLeave={onStickyUserLeave}
        >
          <div
            className={`${styles.stickyPinBody} ${styles.bubble} ${styles.user}`}
          >
            {stickyPreview.msg.images?.length && appearance.showMessagePreviewImage ? (
              <div className={styles.userImages}>
                {stickyPreview.msg.images.map((img, idx) => (
                  <img
                    key={`pin-img-${idx}`}
                    className={styles.userImage}
                    src={img.dataUrl}
                    alt={t.imageAttachment}
                    loading="lazy"
                    draggable="false"
                    onClick={(event) => {
                      event.stopPropagation();
                      openImagePreview(img);
                    }}
                  />
                ))}
              </div>
            ) : null}
            {stickyPreview.view.text ? (
              <div
                className={`${styles.userPlain}${
                  !stickyExpanded && stickyPreview.view.needsToggle ? ` ${styles.clamped}` : ""
                }`}
              >
                {stickyPreview.view.text}
              </div>
            ) : null}
            {stickyPreview.view.tags.length ? (
              <div className={styles.userTags}>
                {stickyPreview.view.tags.map((tag, idx) => (
                  <Tag
                    key={`pin-tag-${idx}`}
                    color="blue"
                    className={`${styles.userTag}${tag.kind === "file" ? ` ${styles.userTagFile}` : ""}`}
                    title={tag.url || tag.label}
                  >
                    {tag.label || tag.content}
                  </Tag>
                ))}
              </div>
            ) : null}
          </div>
          {stickyNeedsToggle && (stickyHover || stickyExpanded) ? (
            <button
              type="button"
              className={styles.stickyToggle}
              aria-expanded={stickyExpanded}
              aria-label={stickyExpanded ? t.stickyCollapse : t.stickyExpand}
              onClick={(event) => {
                event.stopPropagation();
                toggleStickyExpanded();
              }}
            >
              {stickyExpanded ? (
                <ChevronUpOutline size={14} />
              ) : (
                <ChevronDownOutline size={14} />
              )}
              <span>{stickyExpanded ? t.stickyCollapse : t.stickyExpand}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      {jumpMounted ? (
        <button
          type="button"
          className={`${styles.jumpLatest} ${styles.jumpLatestMotion} pi-interactive ${jumpEntered ? styles.jumpLatestVisible : styles.jumpLatestHidden}`}
          title={t.scrollToLatest}
          aria-label={t.scrollToLatest}
          onClick={jumpToLatest}
        >
          <ArrowDownOutline size={16} />
          <span>{t.scrollToLatest}</span>
        </button>
      ) : null}
      </div>
      <ImageLightbox
        dataUrl={imagePreview?.dataUrl ?? null}
        mimeType={imagePreview?.mimeType ?? ""}
        onClose={closeImagePreview}
      />
    </>
  );
}

export default MessageList;

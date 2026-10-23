import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Virtualizer,
  type CustomContainerComponentProps,
  type VirtualizerHandle,
} from "virtua";
import { Button, Tag, Tooltip, Typography } from "antd";
import { fontSizeRem } from "../../../shared/appearance";
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
  lastIdPerRound,
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
import { decideFollowOnIntent, type FollowIntent } from "@renderer/utils/follow-bottom";
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
 * 虚拟滚动由 virtua 承担：视口外额外渲染的像素。太大会重复挂载 Markdown 行，
 * 拖动时整窗卡死；太小则快速滚动会露白。
 */
const OVERSCAN_PX = 280;
const NEAR_BOTTOM_PX = 120;
/** virtua 的行高估值：接近真实行高，锚定补偿的位移才不会被放大成剧烈跳动。 */
const EST_ROW_HEIGHT = 120;

type Props = {
  messages: ChatMessage[];
  streaming: ChatMessage | null;
  running: boolean;
  retryHint?: ChatRetryHint | null;
  historyLoading?: boolean;
  /** 面板被折叠/让位给编辑器区域时为 false。 */
  visible?: boolean;
};

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
  const lastJumpedUserId = useRef<string | null>(null);
  /** Avoid follow-bottom immediately undoing the post-send card-bottom scroll. */
  const suppressFollowBottomUntil = useRef(0);
  /** virtua 的虚拟列表实例：负责测量、窗口与滚动位置补偿。 */
  const virtualizerRef = useRef<VirtualizerHandle | null>(null);
  /** virtua 容器元素，用于实测其在滚动内容中的起始偏移。 */
  const virtualHostRef = useRef<HTMLDivElement | null>(null);
  /**
   * 虚拟列表之前的内容高度（.inner 上内边距 + 顶部“加载更早”入口）。
   * virtua 以此为基准换算可见区间，填错会让视口整体偏移。
   */
  const [startMargin, setStartMargin] = useState(0);
  /** 前插更早历史时置位：virtua 据此把滚动位置按尾部对齐，避免视口跳动。 */
  const [shift, setShift] = useState(false);

  /**
   * 贴底状态：true = 跟随实时边缘；false = 用户在读历史，视口不得自行移动。
   * 只由用户意图翻转（滚轮 / 键盘 / 触摸 / 拖动滚动条），滚动事件不参与 ——
   * 虚拟列表的锚定补偿也会派发 scroll 事件，用它判断意图会把视口吸回底部。
   */
  const followBottom = useRef(true);
  /** Session switch / hydrate settle — snap to bottom, never smooth-scroll. */
  const settlingSession = useRef(false);
  const sessionJumpToken = useRef(0);
  /** Template flag: hide list until first bottom snap (avoids blank spacer flash). */
  const [settlingUi, setSettlingUi] = useState(false);
  /** Show floating jump control when user scrolled away from latest. */
  const [showJumpLatest, setShowJumpLatest] = useState(false);
  const scrollRaf = useRef(0);
  /** 意图序号：滚动事件到达前若用户又改了意图，排队的复查作废。 */
  const intentToken = useRef(0);
  /** 向下意图的复查帧：滚轮/键盘事件先于滚动发生，底部区域要等滚动落地才能判断。 */
  const liveEdgeCheckRaf = useRef(0);
  /** 抓着滚动条：此时视口由用户手动导航，任何贴底都要让位。 */
  const scrollbarGrab = useRef(false);

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

  /** 更早历史的分页游标；没有更早历史时不显示入口。 */
  const olderState = useMemo(() => {
    const id = sessions.activeId;
    if (!id) return null;
    return chat.olderBySession[id] ?? null;
  }, [chat.olderBySession, sessions.activeId]);

  /**
   * 前插一页更早历史。shift 让 virtua 按“尾部对齐”补偿滚动位置，
   * 前插后视口内容不跳动。
   *
   * shift 是一次性的：virtua 只在“行数变化的那一次渲染”消费它。
   * 前插的行可能全是分组从属行（work section 只在首行渲染），
   * 行数不变 → shift 无人消费，会一直挂着，
   * 下一次行数变化（比如流式输出的新行）就会被当成“前插”而按尾部对齐，
   * 视口直接被拖到内容末尾。所以这里用 pendingShift 记账，落地后立即核销。
   */
  const pendingShift = useRef(false);
  async function onLoadOlder(): Promise<void> {
    const id = sessions.activeId;
    if (!id) return;
    pendingShift.current = true;
    setShift(true);
    const added = await chat.loadOlderMessages(id);
    if (added <= 0 || sessions.activeId !== id) {
      pendingShift.current = false;
      setShift(false);
    }
  }

  const sessionId = sessions.activeId;

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

  function isNearBottom(el: HTMLElement): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }

  /**
   * virtua 容器元素：默认容器拿不到引用，这里包一层，实测虚拟列表在滚动内容中的
   * 起始偏移（.inner 上内边距 + 顶部“加载更早”入口 + 间距）。
   * 用 useState 固定组件身份：身份一变 virtua 容器会被重建，滚动位置与行高缓存全丢。
   */
  const [VirtualHost] = useState(() =>
    function VirtualHost({
      style,
      children,
      ref,
    }: CustomContainerComponentProps): ReactElement {
      return (
        <div
          ref={(el) => {
            virtualHostRef.current = el;
            if (typeof ref === "function") ref(el);
            else if (ref) ref.current = el;
          }}
          style={style}
        >
          {children}
        </div>
      );
    },
  );

  /** 贴到滚动内容底部，末尾的“正在重试 / 等待 / 排队提示”也在可视区内。 */
  function scrollToBottom(): void {
    const sc = scrollerRef.current;
    if (!sc) return;
    sc.scrollTop = sc.scrollHeight;
  }

  /** virtua 行高变化：贴底时重新收敛到底部。 */
  const virtualResizeRaf = useRef(0);
  function handleVirtualResize(): void {
    if (virtualResizeRaf.current) return;
    virtualResizeRaf.current = requestAnimationFrame(() => {
      virtualResizeRaf.current = 0;
      // 行高变化会顶长内容，贴底状态下重新贴回底部；已经离开底部则不打扰阅读。
      const sc = scrollerRef.current;
      if (!sc || !followBottom.current) return;
      if (isNearBottom(sc)) scrollToBottom();
    });
  }

  /**
   * 虚拟列表之前的头部高度：virtua 以此为基准换算可见区间，填错会让视口整体偏移。
   * 头部只有 .inner 上内边距与顶部“加载更早”入口，两者变化或面板改尺寸时都要重测。
   */
  useLayoutEffect(() => {
    const sc = scrollerRef.current;
    const host = virtualHostRef.current;
    if (!sc || !host) return;
    const measure = (): void => {
      const next = Math.round(
        host.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop,
      );
      setStartMargin((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(sc);
    return () => observer.disconnect();
  }, [olderState?.hasMore, olderState?.loading, sessionId]);

  /**
   * shift 只在行数变化的那一次渲染生效，用完立刻复位。
   * 前插的行全是分组从属行时行数不变，shift 没人消费就会一直挂着，
   * 等下一次行数变化（流式新行）时被误当成“前插”而按尾部对齐，视口直接被拖到内容末尾。
   * 所以这里盯住“消息数 + 行数”：前插落地后（无论有没有产生新行）立刻核销。
   */
  useLayoutEffect(() => {
    if (!pendingShift.current) return;
    pendingShift.current = false;
    setShift(false);
  }, [renderRows.length, messages.length]);

  const instantSnapToken = useRef(0);
  function jumpToBottomInstant(): void {
    // Jump control / settle are the only callers; anything else must not move
    // the viewport while the user is reading history.
    if (!followBottom.current || paneHidden()) return;
    const sc = scrollerRef.current;
    if (!sc) return;
    const token = ++instantSnapToken.current;
    scrollToBottom();
    // Deferred re-snaps must re-check follow: the user may scroll up while these
    // rAFs are still queued — never yank the viewport back down afterwards.
    requestAnimationFrame(() => {
      if (token !== instantSnapToken.current || (!followBottom.current && !settlingSession.current)) {
        return;
      }
      if (!followBottom.current) return;
      if (!scrollerRef.current) return;
      scrollToBottom();
      requestAnimationFrame(() => {
        if (token !== instantSnapToken.current || (!followBottom.current && !settlingSession.current)) {
          return;
        }
        if (!followBottom.current) return;
        scrollToBottom();
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
  function scheduleBottomScroll(): void {
    // Hard latch first: a reader must never be yanked, even if followBottom is
    // still momentarily true in a state snapshot taken mid-wheel.
    if (!followBottom.current) return;
    // Minimized / hidden: no layout work until the window is restored.
    if (document.hidden || paneHidden()) return;
    if (bottomScrollRaf.current) return;
    bottomScrollRaf.current = requestAnimationFrame(() => {
      bottomScrollRaf.current = 0;
      // Re-check at fire time, not just schedule time: the user may have scrolled
      // up after the snap was queued (the follow decision is sync, this rAF is
      // not) — never yank the viewport back down while they read history.
      if (document.hidden || paneHidden() || !followBottom.current) return;
      // Even when a prior state sample left follow=true (samples are not atomic
      // with a mid-await wheel), the hard reading latch still wins at fire time.
      if (!followBottom.current) return;
      scrollToBottom();
    });
  }

  /** 面板 / 窗口重新可见：贴底收敛一次。 */
  function onBecameVisible(): void {
    if (paneHidden() || document.hidden) return;
    if (!followBottom.current) return;
    scheduleBottomScroll();
    requestAnimationFrame(() => {
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
    requestAnimationFrame(() => {
      jumpToBottomInstant();
    });
  }

  /** Bottom snap for session settle / post-hydrate; guards follow + settle + latch. */
  function snapSessionToBottom(token: number): void {
    if (token !== sessionJumpToken.current) return;
    if (settlingSession.current) {
      // settle state is being snapped anyway — do NOT reset a mid-settle latch.
      lastJumpedUserId.current = rowsRef.current.latestUserMessageId;
      return;
    }
    // historyLoading finished outside settle (hydrate landed late): jump to live.
    if (!followBottom.current) {
      disengageHistoryReading();
      lastJumpedUserId.current = rowsRef.current.latestUserMessageId;
    }
    jumpToBottomInstant();
  }

  /** Cold start + session switch: wait for hydrate, then land on bottom (no blank spacer). */
  async function beginSessionSettle(): Promise<void> {
    const token = ++sessionJumpToken.current;
    settlingSession.current = true;
    setSettlingUi(true);
    disengageHistoryReading();

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
    if (rowsRef.current.allMessages.length === 0) {
      const emptyDeadline = Date.now() + 120;
      while (
        token === sessionJumpToken.current &&
        rowsRef.current.allMessages.length === 0 &&
        Date.now() < emptyDeadline
      ) {
        await new Promise<void>((r) => setTimeout(r, 40));
      }
    }
    if (token !== sessionJumpToken.current) return;

    await snapSessionToBottom(token);
    // Land on the bottom BEFORE revealing (the old flow revealed only after all
    // re-snaps; with early reveal the stale scroll offset would flash otherwise).
    // 多等一帧：virtua 首帧的行高是估值，等它校正后再贴底，露出的位置才准。
    if (token === sessionJumpToken.current) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      jumpToBottomInstant();
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

  /** 取消所有排队中的贴底动作：用户已接管视口，不能再被拉回底部。 */
  function cancelQueuedBottomSnaps(): void {
    if (bottomScrollRaf.current) {
      cancelAnimationFrame(bottomScrollRaf.current);
      bottomScrollRaf.current = 0;
    }
    // Invalidate instant-snap rAF chains queued before the user scrolled away.
    instantSnapToken.current++;
  }

  /**
   * 用户意图的唯一入口：向上 = 回看历史，向下 = 回到实时边缘。
   * 贴底状态只在这里翻转，滚动事件无权改动它。
   */
  function applyFollowIntent(intent: FollowIntent): void {
    intentToken.current++;
    const sc = scrollerRef.current;
    if (!sc) return;
    // 内容装得下时没有历史可看，保持贴底。
    if (intent === "up" && sc.scrollHeight <= sc.clientHeight + 1) return;
    const decision = decideFollowOnIntent({
      intent,
      nearBottom: isNearBottom(sc),
      following: followBottom.current,
    });
    if (!decision.engaged) return;
    if (decision.following) {
      disengageHistoryReading();
      return;
    }
    cancelSessionSettle();
    suppressFollowBottomUntil.current = 0;
    cancelQueuedBottomSnaps();
    engageHistoryReading();
  }

  /**
   * 向下意图的落地复查：滚轮/键盘事件先于滚动发生，此刻还判断不出是否进入底部区域，
   * 等滚动真正落地后再看一次。用户若在期间改了意图（序号变化），这次复查作废。
   */
  function scheduleLiveEdgeCheck(): void {
    const token = intentToken.current;
    if (liveEdgeCheckRaf.current) cancelAnimationFrame(liveEdgeCheckRaf.current);
    liveEdgeCheckRaf.current = requestAnimationFrame(() => {
      liveEdgeCheckRaf.current = 0;
      if (token !== intentToken.current) return;
      applyFollowIntent("down");
    });
  }

  /** 会话贴底是多段异步快照，用户中途上滑时整体取消。 */
  function cancelSessionSettle(): void {
    if (!settlingSession.current) return;
    sessionJumpToken.current++;
    settlingSession.current = false;
    setSettlingUi(false);
  }

  /**
   * Wheel events only fire for real user input (programmatic scrollTop writes do
   * not). One upward tick disengages follow immediately — even inside the
   * near-bottom threshold, where stream snaps would otherwise keep resetting the
   * user's scroll progress every chunk and they could never escape.
   */
  function onScrollerWheel(event: WheelEvent): void {
    if (event.deltaY === 0) return;
    // ctrl+wheel 是触控板捏合缩放，不是滚动意图。
    if (event.ctrlKey) return;
    if (event.deltaY < 0) {
      applyFollowIntent("up");
      return;
    }
    applyFollowIntent("down");
    scheduleLiveEdgeCheck();
  }

  function onScrollerKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home") {
      applyFollowIntent("up");
      return;
    }
    if (event.key === "ArrowDown" || event.key === "PageDown" || event.key === "End") {
      applyFollowIntent("down");
      scheduleLiveEdgeCheck();
    }
  }

  const touchStartY = useRef(-1);
  function onScrollerTouchStart(event: TouchEvent): void {
    touchStartY.current = event.touches[0]?.clientY ?? -1;
  }

  /** 手指下移 = 内容上滚 = 回看更早的消息（触摸屏 / 手机网页端没有 wheel 事件）。 */
  function onScrollerTouchMove(event: TouchEvent): void {
    const y = event.touches[0]?.clientY;
    if (y == null || touchStartY.current < 0) return;
    const delta = y - touchStartY.current;
    if (delta > 8) {
      applyFollowIntent("up");
      return;
    }
    if (delta < -8) {
      applyFollowIntent("down");
      scheduleLiveEdgeCheck();
    }
  }

  /**
   * 抓着滚动条 = 用户手动导航：先脱离贴底让出视口，松手时若已回到底部区域再贴回去。
   * 滚动条拖拽不产生 wheel 事件，只能靠 pointerdown/up 判定。
   */
  function onScrollerPointerDown(event: PointerEvent): void {
    const sc = scrollerRef.current;
    if (!sc) return;
    if (event.clientX < sc.getBoundingClientRect().left + sc.clientWidth) return;
    scrollbarGrab.current = true;
    applyFollowIntent("up");
  }

  function onScrollerPointerUp(): void {
    if (!scrollbarGrab.current) return;
    scrollbarGrab.current = false;
    applyFollowIntent("down");
  }

  /** 贴底状态下滚动：把视口重新收敛到底部（内容增长后可能偏离）。 */
  function handleScrollerScroll(): void {
    const sc = scrollerRef.current;
    if (!sc || settlingSession.current) return;
    if (!followBottom.current) return;
    if (isNearBottom(sc)) scrollToBottom();
  }

  /**
   * 滚动事件不参与贴底决策：虚拟列表的锚定补偿同样会派发 scroll 事件
   * （把 scrollTop 往下推回去保持内容视觉位置不变），把它当成用户意图就会把视口吸回底部。
   * 这里只负责跟随态的收敛。
   */
  function onScrollerScroll(): void {
    if (paneHidden()) return;
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0;
      handleScrollerScroll();
    });
  }

  function engageHistoryReading(): void {
    followBottom.current = false;
    setShowJumpLatest(rowsRef.current.allMessages.length > 0);
  }

  function disengageHistoryReading(): void {
    followBottom.current = true;
    setShowJumpLatest(false);
  }

  const latestHandlers = useRef({
    onScrollerScroll,
    onScrollerWheel,
    onScrollerKeydown,
    onScrollerTouchStart,
    onScrollerTouchMove,
    onScrollerPointerDown,
    onScrollerPointerUp,
  });
  latestHandlers.current = {
    onScrollerScroll,
    onScrollerWheel,
    onScrollerKeydown,
    onScrollerTouchStart,
    onScrollerTouchMove,
    onScrollerPointerDown,
    onScrollerPointerUp,
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
    const onPointerUp = (): void => latestHandlers.current.onScrollerPointerUp();
    sc.addEventListener("scroll", onScroll, { passive: true });
    sc.addEventListener("wheel", onWheel, { passive: true });
    sc.addEventListener("keydown", onKeydown);
    sc.addEventListener("touchstart", onTouchStart, { passive: true });
    sc.addEventListener("touchmove", onTouchMove, { passive: true });
    sc.addEventListener("pointerdown", onPointerDown, { passive: true });
    // 松手可能落在面板之外，挂在 window 上才收得到。
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
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
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (scrollRaf.current) {
        cancelAnimationFrame(scrollRaf.current);
        scrollRaf.current = 0;
      }
      if (bottomScrollRaf.current) {
        cancelAnimationFrame(bottomScrollRaf.current);
        bottomScrollRaf.current = 0;
      }
      if (virtualResizeRaf.current) {
        cancelAnimationFrame(virtualResizeRaf.current);
        virtualResizeRaf.current = 0;
      }
      if (liveEdgeCheckRaf.current) {
        cancelAnimationFrame(liveEdgeCheckRaf.current);
        liveEdgeCheckRaf.current = 0;
      }
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

  const prevMessageLength = useRef<number | undefined>(undefined);
  useEffect(() => {
    const len = rowsRef.current.allMessages.length;
    const prevLen = prevMessageLength.current;
    prevMessageLength.current = len;
    const hydratedFromEmpty = (prevLen === 0 || prevLen == null) && len > 0;
    // Critical: hydrate often lands AFTER settle timeouts. Always snap when
    // following bottom / first populate, otherwise the list stays at the top.
    // Skip while hidden — the visibility handler re-snaps once on restore.
    if (
      (followBottom.current || settlingSession.current || hydratedFromEmpty) &&
      !document.hidden &&
      followBottom.current
    ) {
      lastJumpedUserId.current = rowsRef.current.latestUserMessageId;
      setShowJumpLatest(false);
      requestAnimationFrame(() => {
        // User may have scrolled up while this tick was queued — respect it.
        if (!followBottom.current && !settlingSession.current && !hydratedFromEmpty) return;
        jumpToBottomInstant();
      });
    }
  }, [allMessages.length]);

  /** Hydrate can replace history with the same length — still need a bottom snap. */
  const prevLastMessageId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const id = messages.at(-1)?.id ?? null;
    const prev = prevLastMessageId.current;
    prevLastMessageId.current = id;
    if (prev === undefined) return;
    if (!id || id === prev) return;
    if (!followBottom.current) return;
    // A *new* trailing message while already following: just re-snap.
    if (followBottom.current) {
      lastJumpedUserId.current = rowsRef.current.latestUserMessageId;
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
    if (!id || id === lastJumpedUserId.current) return;
    const prevReading = !followBottom.current;
    lastJumpedUserId.current = id;
    if (prevReading) {
      // While the user was reading history and sends a follow-up, follow them
      // down to the new tail — jump immediately, don't wait for settle logic.
      disengageHistoryReading();
      suppressFollowBottomUntil.current = Date.now() + 160;
      requestAnimationFrame(() => {
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
    if (settlingSession.current) {
      requestAnimationFrame(() => {
        jumpToBottomInstant();
      });
      return;
    }
    // Brief pause so follow-bottom doesn't yank away before layout settles.
    suppressFollowBottomUntil.current = Date.now() + 160;
    requestAnimationFrame(() => {
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
    if (document.hidden || !followBottom.current) return;
    const prevStreaming = prev.streaming ?? null;
    const prevRunning = prev.running ?? false;
    const justFinished = Boolean(prevRunning || prevStreaming) && !running && !streaming;
    // Follow while generating; also snap once when the turn settles (actions
    // mount) — but never yank a user who scrolled up to read history.
    if (running || streaming || justFinished) {
      if (!followBottom.current) return;
      // Coalesced + re-checked at fire time (never yanks a scrolled-up reader).
      scheduleBottomScroll();
      if (justFinished) {
        requestAnimationFrame(() => {
          if (followBottom.current) scrollToBottom();
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
    if (document.hidden || !followBottom.current) return;
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
    for (const msg of allMessages) {
      if (msg.role === "user") out.set(msg.id, buildUserRowView(msg));
    }
    return out;
  }, [allMessages]);

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
              onOpen={openPreview}
            />
          </div>
        </article>
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
  }

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

          <Virtualizer
            ref={virtualizerRef}
            as={VirtualHost}
            data={renderRows}
            scrollRef={scrollerRef}
            shift={shift}
            startMargin={startMargin}
            bufferSize={OVERSCAN_PX}
            itemSize={EST_ROW_HEIGHT}
            onResize={handleVirtualResize}
          >
            {(msg, index) => renderMessageRow(msg, index)}
          </Virtualizer>

          {showJumpLatest ? null : (
            <>
              {retryHint ? (
                <div className={styles.runningIndicator}>
                  <span className={`${styles.dot} ${styles.warn}`} />
                  <Typography.Text type="secondary" style={{ fontSize: fontSizeRem(12) }}>
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

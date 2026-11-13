import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  Virtualizer,
  type CustomContainerComponentProps,
} from "virtua";
import type { ChatMessage } from "@renderer/stores/chat";
import { useChatStore } from "@renderer/stores/chat";
import { useSessionsStore } from "@renderer/stores/sessions";
import { decideFollowOnIntent, type FollowIntent } from "@renderer/utils/follow-bottom";
import {
  innerScrollCanSwallow,
  type InnerScrollMetrics,
} from "@renderer/utils/inner-scroll";
import { foldAnchorScrollDelta } from "@renderer/utils/fold-anchor";
import { nextFrame } from "@renderer/components/next-frame";

/**
 * 虚拟滚动由 virtua 承担：视口外额外渲染的像素。太大会重复挂载 Markdown 行，
 * 拖动时整窗卡死；太小则快速滚动会露白。
 */
const OVERSCAN_PX = 200;
const NEAR_BOTTOM_PX = 120;
/** 距顶部多近时自动补更早的历史。 */
const LOAD_OLDER_TOP_PX = 360;
/**
 * 用户展开/折叠是一次局部重排：这段时间内的贴底会把视口拽到新的末尾，
 * 看起来就是“内容往上开”。窗口内改为锚定被点的行，内容只向下推。
 *
 * shortcut: 窗口固定 400ms 不续期（续期会让流式输出永远不跟随）；
 * 更慢的异步渲染会晚于窗口落地，那一次长高仍会贴底。
 */
const FOLD_HOLD_MS = 400;

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

type OlderState = {
  hasMore?: boolean;
  cursor?: string | null;
  loading?: boolean;
} | null;

type Params = {
  sessionId: string | null;
  visible: boolean | undefined;
  historyLoading: boolean | undefined;
  messages: ChatMessage[];
  allMessagesLength: number;
  latestUserMessageId: string | null;
  renderRowsLength: number;
  streaming: ChatMessage | null;
  running: boolean;
  olderState: OlderState;
};

/**
 * 消息区的滚动控制：贴底跟随、历史分页、会话切换贴底、用户意图判定。
 *
 * 从 MessageList 拆出，保持所有 ref/effect 的原有顺序与语义；
 * 只暴露模板需要的 refs、状态与动作。
 */
export function useMessageScroll({
  sessionId,
  visible,
  historyLoading,
  messages,
  allMessagesLength,
  latestUserMessageId,
  renderRowsLength,
  streaming,
  running,
  olderState,
}: Params) {
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
  /** 折叠/展开窗口：期内钉住被点行的视口位置，避免贴底把它顶走。 */
  const foldAnchor = useRef<{ el: Element; top: number; until: number } | null>(null);
  /** virtua 容器元素，用于实测其在滚动内容中的起始偏移。 */
  const virtualHostRef = useRef<HTMLDivElement | null>(null);
  /**
   * 虚拟列表之前的内容高度（.inner 上内边距）。
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
  /** 意图序号：滚动事件到达前若用户又改了意图，排队的复查作废。 */
  const intentToken = useRef(0);
  /** 向下意图的复查帧：滚轮/键盘事件先于滚动发生，底部区域要等滚动落地才能判断。 */
  const liveEdgeCheckRaf = useRef(0);
  /** 抓着滚动条：此时视口由用户手动导航，任何贴底都要让位。 */
  const scrollbarGrab = useRef(false);
  /** 在内容区按住不放：可能是拖选文本，贴底会把选区顶回去。 */
  const selectDrag = useRef(false);

  const latestUserIdRef = useRef(latestUserMessageId);
  latestUserIdRef.current = latestUserMessageId;
  const allMessagesLengthRef = useRef(allMessagesLength);
  allMessagesLengthRef.current = allMessagesLength;

  /** 更早历史的分页游标；自动加载用它判断是否还能继续往前翻。 */
  const olderStateRef = useRef(olderState);
  olderStateRef.current = olderState;

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
    const id = useSessionsStore.getState().activeId;
    if (!id) return;
    pendingShift.current = true;
    setShift(true);
    const added = await useChatStore.getState().loadOlderMessages(id);
    if (added <= 0 || useSessionsStore.getState().activeId !== id) {
      pendingShift.current = false;
      setShift(false);
    }
  }

  const loadOlderRef = useRef(onLoadOlder);
  loadOlderRef.current = onLoadOlder;

  /**
   * 接近顶部自动补一页。常规滚动要求已经在回看历史（followBottom=false），
   * 滚轮/键盘的明确上翻用 force 覆盖该判断，短会话也能继续往前加载。
   */
  function maybeLoadOlder(force = false): void {
    const sc = scrollerRef.current;
    if (!sc) return;
    const older = olderStateRef.current;
    if (!older?.hasMore || !older.cursor || older.loading) return;
    if (pendingShift.current || settlingSession.current || historyLoadingRef.current) return;
    if (!force && followBottom.current) return;
    if (sc.scrollTop > LOAD_OLDER_TOP_PX) return;
    void loadOlderRef.current();
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

  /** 已经贴在底部就不必再写：写入会打断平滑滚动，还会派发多余的 scroll 事件。 */
  function atBottom(sc: HTMLElement): boolean {
    return sc.scrollHeight - sc.scrollTop - sc.clientHeight < 1;
  }

  /**
   * 贴底写入本体，只读 refs，任何帧内阶段都可调用。
   *
   * 必须由 ResizeObserver 同步驱动：RO 回调在本帧 paint 之前，写进去的位置当场生效。
   * 放进 rAF 会读到上一帧布局的 scrollHeight，等行高修正落地后底部又低了一截，
   * 下一帧才补上 —— 贴底永远差一步，就是“消息区抽搐”。
   */
  function commitBottomScroll(): void {
    // A reader must never be yanked, even if followBottom is still momentarily
    // true in a state snapshot taken mid-wheel.
    if (!followBottom.current || selectDrag.current) return;
    // Minimized / hidden: no layout work until the window is restored.
    if (document.hidden || paneHidden()) return;
    const sc = scrollerRef.current;
    if (!sc) return;
    if (holdFoldAnchor(sc)) return;
    if (atBottom(sc)) return;
    scrollToBottom();
  }

  /**
   * 展开/折叠期间把被点行的视口位置钉住，超出视口时再向下让位。
   * 块边界取整条消息行：展开体不一定在被点行的直接父级里。
   */
  function holdFoldAnchor(sc: HTMLElement): boolean {
    const anchor = foldAnchor.current;
    if (!anchor) return false;
    if (Date.now() > anchor.until || !anchor.el.isConnected) {
      foldAnchor.current = null;
      return false;
    }
    const block = anchor.el.closest("[data-msg-id]") ?? anchor.el.parentElement ?? anchor.el;
    const scBox = sc.getBoundingClientRect();
    const delta = foldAnchorScrollDelta({
      anchorTop: anchor.top,
      headTop: anchor.el.getBoundingClientRect().top,
      blockBottom: block.getBoundingClientRect().bottom,
      viewTop: scBox.top,
      viewBottom: scBox.bottom,
    });
    if (Math.abs(delta) >= 1) sc.scrollTop += delta;
    return true;
  }

  const commitScrollRef = useRef(commitBottomScroll);
  commitScrollRef.current = commitBottomScroll;

  /** 非尺寸变化触发的兜底贴底（新消息、尾部提示），一帧最多写一次。 */
  const bottomScrollRaf = useRef(0);
  function scheduleBottomScroll(): void {
    if (!followBottom.current) return;
    if (document.hidden || paneHidden()) return;
    if (bottomScrollRaf.current) return;
    bottomScrollRaf.current = requestAnimationFrame(() => {
      bottomScrollRaf.current = 0;
      commitBottomScroll();
    });
  }

  /**
   * 内容真正长高/变矮都体现在 .inner 高度上（virtua 容器高度即总尺寸）。
   * 在 RO 里同步贴底，视口位置与内容在同一帧完成，看不到中间态。
   */
  const innerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const observer = new ResizeObserver(() => commitScrollRef.current());
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  /**
   * 虚拟列表之前的头部高度：virtua 以此为基准换算可见区间，填错会让视口整体偏移。
   * 移除“加载更早”入口后头部只剩 .inner 上内边距，会话切换时重测即可。
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
  }, [sessionId]);

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
  }, [renderRowsLength, messages.length]);

  const instantSnapToken = useRef(0);
  function jumpToBottomInstant(): void {
    // Jump control / settle are the only callers; anything else must not move
    // the viewport while the user is reading history.
    if (!followBottom.current || paneHidden()) return;
    // 贴底是显式意图，展开窗口的锚定不能再把它拉回去。
    foldAnchor.current = null;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在可见性翻转时收敛，与原实现一致
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
      lastJumpedUserId.current = latestUserIdRef.current;
      return;
    }
    // historyLoading finished outside settle (hydrate landed late): jump to live.
    if (!followBottom.current) {
      disengageHistoryReading();
      lastJumpedUserId.current = latestUserIdRef.current;
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
    // 逐帧轮询：history 现在毫秒级落地，固定的 40ms 轮询反而把空窗拉长。
    const deadline = Date.now() + 8_000;
    while (token === sessionJumpToken.current && Date.now() < deadline) {
      if (!historyLoadingRef.current) {
        // 等一帧让 hydrate 的渲染提交，行高与贴底才有真实数据。
        await nextFrame();
        break;
      }
      await nextFrame();
    }
    if (token !== sessionJumpToken.current) return;

    // An empty list after the hydrate frame is final (brand-new session) — don't
    // burn the old 400ms empty-poll on every fresh chat.
    if (allMessagesLengthRef.current === 0) {
      const emptyDeadline = Date.now() + 120;
      while (
        token === sessionJumpToken.current &&
        allMessagesLengthRef.current === 0 &&
        Date.now() < emptyDeadline
      ) {
        await nextFrame();
      }
    }
    if (token !== sessionJumpToken.current) return;

    snapSessionToBottom(token);
    // Land on the bottom BEFORE revealing (the old flow revealed only after all
    // re-snaps; with early reveal the stale scroll offset would flash otherwise).
    // 多等一帧：virtua 首帧的行高是估值，等它校正后再贴底，露出的位置才准。
    if (token === sessionJumpToken.current) {
      await nextFrame();
      jumpToBottomInstant();
      await nextFrame();
      jumpToBottomInstant();
      setSettlingUi(false);
    }
    for (const waitMs of [0, 50, 120, 280, 600]) {
      if (waitMs) await sleep(waitMs);
      if (token !== sessionJumpToken.current) return;
      snapSessionToBottom(token);
    }
    if (token === sessionJumpToken.current) {
      settlingSession.current = false;
      // Final snap after reveal (layout may change when visibility returns).
      await nextFrame();
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
    // 用户接管视口，展开窗口的锚定立即让位。
    foldAnchor.current = null;
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
   * 滚轮落在消息内部的纵向滚动区域（代码块、图表预览、思考块）且该区域还能朝这个
   * 方向滚：事件属于子区域，不能当成“用户在翻历史”，否则在 markdown 预览里滚一下就
   * 翻掉跟随状态，消息区还会被贴底拉回。
   * 子区域滚到边界后交回消息区（浏览器的滚动链本就这么做），这里只识别“还能滚”。
   */
  function innerScrollOwnsWheel(event: WheelEvent): boolean {
    const target = event.target instanceof Element ? event.target : null;
    const inner = target?.closest<HTMLElement>("[data-inner-scroll]") ?? null;
    if (!inner) return false;
    const metrics: InnerScrollMetrics = {
      scrollHeight: inner.scrollHeight,
      clientHeight: inner.clientHeight,
      scrollTop: inner.scrollTop,
    };
    return innerScrollCanSwallow(metrics, event.deltaY);
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
    if (innerScrollOwnsWheel(event)) return;
    if (event.deltaY < 0) {
      applyFollowIntent("up");
      maybeLoadOlder(true);
      return;
    }
    applyFollowIntent("down");
    scheduleLiveEdgeCheck();
  }

  function onScrollerKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home") {
      applyFollowIntent("up");
      maybeLoadOlder(true);
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
      maybeLoadOlder(true);
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
    // 中键自动滚动不产生滚轮事件，视口得先交给用户。
    if (event.button === 1) {
      applyFollowIntent("up");
      return;
    }
    if (event.clientX < sc.getBoundingClientRect().left + sc.clientWidth) {
      // 内容区按下：拖选文本时浏览器会自动滚动视口，先让位。
      selectDrag.current = true;
      return;
    }
    scrollbarGrab.current = true;
    applyFollowIntent("up");
  }

  function onScrollerPointerUp(): void {
    if (selectDrag.current) {
      selectDrag.current = false;
      // 拖选可能已经把视口带上去了：交还用户，别再贴回底部。
      const sc = scrollerRef.current;
      if (sc && !isNearBottom(sc)) engageHistoryReading();
      return;
    }
    if (!scrollbarGrab.current) return;
    scrollbarGrab.current = false;
    applyFollowIntent("down");
  }

  /**
   * 折叠/展开是用户主动的局部重排：钉住这一行而不是贴底，
   * 否则视口被拽到新的末尾，正在看的那一行会“往上开”。
   */
  function onScrollerClickCapture(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const toggle = target?.closest("[aria-expanded], [data-fold-toggle]");
    if (!toggle) return;
    foldAnchor.current = {
      el: toggle,
      top: toggle.getBoundingClientRect().top,
      until: Date.now() + FOLD_HOLD_MS,
    };
  }

  function engageHistoryReading(): void {
    followBottom.current = false;
    setShowJumpLatest(allMessagesLengthRef.current > 0);
  }

  function disengageHistoryReading(): void {
    followBottom.current = true;
    setShowJumpLatest(false);
  }

  const latestHandlers = useRef({
    onScrollerWheel,
    onScrollerKeydown,
    onScrollerTouchStart,
    onScrollerTouchMove,
    onScrollerPointerDown,
    onScrollerPointerUp,
    onScrollerClickCapture,
  });
  latestHandlers.current = {
    onScrollerWheel,
    onScrollerKeydown,
    onScrollerTouchStart,
    onScrollerTouchMove,
    onScrollerPointerDown,
    onScrollerPointerUp,
    onScrollerClickCapture,
  };

  useEffect(() => {
    const sc = scrollerRef.current;
    if (!sc) return;
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
    const onClick = (event: MouseEvent): void =>
      latestHandlers.current.onScrollerClickCapture(event);
    const onScroll = (): void => maybeLoadOlder();
    sc.addEventListener("wheel", onWheel, { passive: true });
    sc.addEventListener("keydown", onKeydown);
    sc.addEventListener("scroll", onScroll, { passive: true });
    sc.addEventListener("touchstart", onTouchStart, { passive: true });
    sc.addEventListener("touchmove", onTouchMove, { passive: true });
    sc.addEventListener("pointerdown", onPointerDown, { passive: true });
    // 捕获阶段：展开按钮自己会 stopPropagation，冒泡阶段收不到。
    sc.addEventListener("click", onClick, true);
    // 松手可能落在面板之外，挂在 window 上才收得到。
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      sc.removeEventListener("wheel", onWheel);
      sc.removeEventListener("keydown", onKeydown);
      sc.removeEventListener("scroll", onScroll);
      sc.removeEventListener("click", onClick, true);
      sc.removeEventListener("touchstart", onTouchStart);
      sc.removeEventListener("touchmove", onTouchMove);
      sc.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (bottomScrollRaf.current) {
        cancelAnimationFrame(bottomScrollRaf.current);
        bottomScrollRaf.current = 0;
      }
      if (liveEdgeCheckRaf.current) {
        cancelAnimationFrame(liveEdgeCheckRaf.current);
        liveEdgeCheckRaf.current = 0;
      }
      instantSnapToken.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 监听只挂一次，回调经 latestHandlers 转发
  }, []);

  const prevSessionId = useRef<string | null | undefined>(undefined);
  /** 冷启动时消息可能先于列表挂载就绪：在首帧前隐藏，避免先露顶部再跳到底部。 */
  useLayoutEffect(() => {
    void beginSessionSettle();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载时执行，与原实现一致
  }, []);
  useLayoutEffect(() => {
    const prev = prevSessionId.current;
    prevSessionId.current = sessionId;
    if (prev === undefined) return;
    pendingShift.current = false;
    setShift(false);
    disengageHistoryReading();
    void beginSessionSettle();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖会话切换，与原实现一致
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在加载结束边沿收尾，与原实现一致
  }, [historyLoading]);

  const prevMessageLength = useRef<number | undefined>(undefined);
  useEffect(() => {
    const len = allMessagesLengthRef.current;
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
      lastJumpedUserId.current = latestUserIdRef.current;
      setShowJumpLatest(false);
      requestAnimationFrame(() => {
        // User may have scrolled up while this tick was queued — respect it.
        if (!followBottom.current && !settlingSession.current && !hydratedFromEmpty) return;
        jumpToBottomInstant();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只跟踪消息数量变化，与原实现一致
  }, [allMessagesLength]);

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
      lastJumpedUserId.current = latestUserIdRef.current;
      requestAnimationFrame(() => {
        if (!followBottom.current && !settlingSession.current) return;
        jumpToBottomInstant();
      });
    } else if (!settlingSession.current) {
      // hydrate landed late (settle already finished) — snap now.
      snapSessionToBottom(sessionJumpToken.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只跟踪尾部消息变化，与原实现一致
  }, [messages]);

  /** When a new latest user message appears (send / re-edit send): leave room for agent. */
  const prevLatestUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const id = latestUserIdRef.current;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只跟踪最新用户消息变化，与原实现一致
  }, [latestUserMessageId]);

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
      // Coalesced + re-checked at fire time (never yanks a scrolled-up reader).
      scheduleBottomScroll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖流式/运行状态，与原实现一致
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在流式行内容变化时贴底，与原实现一致
  }, [streaming]);

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

  return {
    scrollerRef,
    innerRef,
    startMargin,
    shift,
    settlingUi,
    showJumpLatest,
    jumpVisible,
    jumpMounted,
    jumpEntered,
    jumpToLatest,
    commitBottomScroll,
    scheduleBottomScroll,
    VirtualHost,
    Virtualizer,
    overscanPx: OVERSCAN_PX,
  };
}

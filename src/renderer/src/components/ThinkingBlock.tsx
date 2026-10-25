import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { ChevronForwardOutline } from "@renderer/components/icons/ionicons";
import { useI18n } from "@renderer/i18n/use-i18n";
import { formatDuration } from "@renderer/utils/format-duration";
import styles from "./ThinkingBlock.module.css";

const MarkdownView = lazy(() => import("@renderer/components/MarkdownView"));

type Props = {
  thinking: string;
  /** True while the model is still producing thinking (before answer text). */
  streaming?: boolean;
  /** True once the whole turn finished: fold finished thinking (Codex-like). */
  autoCollapse?: boolean;
  /** 行首图标（工作区小节内与工具行对齐）。 */
  leadingIcon?: ReactNode;
  /** 思考耗时（毫秒）；历史会话没有记录，不传就不显示。 */
  durationMs?: number;
  /** 本次思考的起始墙钟时间；流式期间用它做实时计时。 */
  startedAt?: number;
};

/**
 * History rows stay collapsed (cheap open). Live streaming auto-expands;
 * once the whole turn finishes the block folds back up (Codex-like), unless
 * the user expanded it manually.
 */
export function ThinkingBlock({
  thinking,
  streaming,
  autoCollapse,
  leadingIcon,
  durationMs,
  startedAt,
}: Props): ReactNode {
  const t = useI18n();
  const [manuallyOpen, setManuallyOpen] = useState<boolean | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  /** Follow newest text unless the user scrolls up inside the card. */
  const stickToBottom = useRef(true);
  const NEAR_BOTTOM_PX = 48;

  const open = useMemo(() => {
    // Turn finished: only a user-expanded block stays open; history stays folded.
    if (autoCollapse) return manuallyOpen === true;
    if (manuallyOpen !== null) return manuallyOpen;
    return Boolean(streaming);
  }, [autoCollapse, manuallyOpen, streaming]);

  const headLabel = streaming ? t.thinkingStreaming : t.thinking;

  /** 流式期间每秒走一格；不足一秒先不显示，避免停在 0ms 像卡住。 */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!streaming || startedAt == null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [streaming, startedAt]);

  const liveMs = streaming && startedAt != null ? Math.max(0, now - startedAt) : null;
  const elapsedMs = liveMs != null && liveMs >= 1000 ? liveMs : durationMs;

  /** 行尾信息：字数 + 耗时，有多少说多少。 */
  const meta = useMemo(() => {
    const parts: string[] = [];
    if (thinking) parts.push(t.thinkingChars(thinking.length));
    if (elapsedMs != null) parts.push(formatDuration(elapsedMs));
    return parts.length ? parts.join(" · ") : null;
  }, [elapsedMs, t, thinking]);

  /** 流式长思考只挂载尾部窗口，防止整段文本常驻 DOM、每 tick 全量布局。 */
  const THINK_LIVE_MAX_CHARS = 16_000;
  const displayThinking = useMemo(() => {
    if (!streaming || thinking.length <= THINK_LIVE_MAX_CHARS) return thinking;
    return `…\n${thinking.slice(-THINK_LIVE_MAX_CHARS)}`;
  }, [streaming, thinking]);

  useEffect(() => {
    if (!streaming) return;
    // Let the computed track live state (auto-expands when the turn is open).
    setManuallyOpen(null);
    stickToBottom.current = true;
  }, [streaming]);

  // Fold everything as soon as the round finishes; users can re-expand manually.
  useEffect(() => {
    if (autoCollapse) setManuallyOpen(false);
  }, [autoCollapse]);

  function toggleOpen(): void {
    setManuallyOpen(!open);
  }

  function pinToBottom(): void {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }

  /**
   * 离开跟随只认滚轮意图；滚回底部附近才恢复。
   * 贴底用的 scrollHeight 会是内容真正长高后的值（scroll 事件晚于 DOM 提交），
   * 若拿它的即时距离判定意图，渲染延迟会被当成“用户往上翻”，一旦超过阈值
   * 就永久关掉跟随 —— 表现就是思考中有时不再自动滚动。
   */
  function onBodyScroll(): void {
    const el = bodyRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX) {
      stickToBottom.current = true;
    }
  }

  function onBodyWheel(event: ReactWheelEvent<HTMLDivElement>): void {
    if (event.deltaY === 0 || event.ctrlKey) return;
    if (event.deltaY < 0) stickToBottom.current = false;
  }

  /** 抓住思考块自己的滚动条或按下中键（中键自动滚动）= 用户手动导航，别再拉回底部。 */
  function onBodyPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button === 1) {
      stickToBottom.current = false;
      return;
    }
    const el = bodyRef.current;
    if (!el) return;
    if (event.clientX < el.getBoundingClientRect().left + el.clientWidth) return;
    stickToBottom.current = false;
  }

  /** 用户正在思考块里选文本时贴底会把选区顶走，先让位（清掉选区就恢复）。 */
  function selectingOwnText(): boolean {
    const el = bodyRef.current;
    const selection = window.getSelection();
    if (!el || !selection || selection.isCollapsed) return false;
    return Boolean(selection.anchorNode && el.contains(selection.anchorNode));
  }

  useEffect(() => {
    if (!streaming || !open || !stickToBottom.current) return;
    pinToBottom();
  }, [streaming, open]);

  /**
   * 内容由 MarkdownView 分两轮提交（先 setState、下一轮才进 DOM），贴底动作总是
   * 早于内容长高。所以跟随不能只靠“数据变化”，要在内容真正长高时再贴一次。
   */
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (!streaming || !stickToBottom.current) return;
      if (selectingOwnText()) return;
      pinToBottom();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [streaming, open, Boolean(thinking)]);

  return (
    <div
      className={`${styles.thinking}${open ? ` ${styles.open}` : ""}`}
    >
      <button type="button" className={styles.thinkingHead} onClick={toggleOpen}>
        {leadingIcon}
        <span
          className={`${styles.label}${streaming ? " copilot-shimmer" : ""}`}
        >
          {headLabel}
        </span>
        {meta ? <span className={styles.meta}>{meta}</span> : null}
        <ChevronForwardOutline
          size={12}
          className={`${styles.hoverChev}${open ? ` ${styles.expanded}` : ""}`}
        />
      </button>
      {open && thinking ? (
        <div
          ref={bodyRef}
          className={`${styles.thinkingBody}${leadingIcon ? ` ${styles.iconIndent}` : ""}`}
          onScroll={onBodyScroll}
          onWheel={onBodyWheel}
          onPointerDown={onBodyPointerDown}
          data-inner-scroll=""
        >
          <div ref={contentRef}>
            <Suspense fallback={null}>
              <MarkdownView
                content={displayThinking}
                variant="chat"
                streaming={streaming}
                className={styles.markdown}
              />
            </Suspense>
          </div>
        </div>
      ) : null}
      {open && streaming && !thinking ? (
        <div className={`${styles.thinkingBody} ${styles.muted}`}>{headLabel}</div>
      ) : null}
    </div>
  );
}

export default ThinkingBlock;

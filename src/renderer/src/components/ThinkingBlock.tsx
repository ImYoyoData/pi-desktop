import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronForwardOutline } from "@renderer/components/icons/ionicons";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./ThinkingBlock.module.css";

type Props = {
  thinking: string;
  /** True while the model is still producing thinking (before answer text). */
  streaming?: boolean;
  /** True once the whole turn finished: fold finished thinking (Codex-like). */
  autoCollapse?: boolean;
};

/**
 * History rows stay collapsed (cheap open). Live streaming auto-expands;
 * once the whole turn finishes the block folds back up (Codex-like), unless
 * the user expanded it manually.
 */
export function ThinkingBlock({ thinking, streaming, autoCollapse }: Props): ReactNode {
  const t = useI18n();
  const [manuallyOpen, setManuallyOpen] = useState<boolean | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
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

  function onBodyScroll(): void {
    const el = bodyRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }

  useEffect(() => {
    if (!streaming) return;
    if (!open || !stickToBottom.current) return;
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [thinking, streaming, open]);

  return (
    <div
      className={`${styles.thinking}${open ? ` ${styles.open}` : ""}`}
    >
      <button type="button" className={styles.thinkingHead} onClick={toggleOpen}>
        <span
          className={`${styles.label}${streaming ? " copilot-shimmer" : ""}`}
        >
          {headLabel}
        </span>
        <ChevronForwardOutline
          size={12}
          className={`${styles.hoverChev}${open ? ` ${styles.expanded}` : ""}`}
        />
      </button>
      {open && thinking ? (
        <div ref={bodyRef} className={styles.thinkingBody} onScroll={onBodyScroll}>
          {displayThinking}
        </div>
      ) : null}
      {open && streaming && !thinking ? (
        <div className={`${styles.thinkingBody} ${styles.muted}`}>{headLabel}</div>
      ) : null}
    </div>
  );
}

export default ThinkingBlock;

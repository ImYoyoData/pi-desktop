import { useRef } from "react";
import { Button, Popover } from "antd";
import { useI18n } from "@renderer/i18n/use-i18n";
import { useMessage } from "@renderer/services/feedback";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { useChatStore } from "@renderer/stores/chat";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import {
  contextCostLabelOf,
  contextFreePctOf,
  contextFullLabelOf,
  contextNeedsCompactAt,
  contextPercentOf,
  contextRingDash,
  contextSegmentsOf,
  contextTokensPairLabelOf,
  contextToneOf,
} from "@renderer/utils/context-usage";
import { useLatest } from "./use-latest";
import styles from "../Composer.module.css";

const TONE_CLASS: Record<string, string> = {
  muted: "ctxMuted",
  ok: "ctxOk",
  warn: "ctxWarn",
  danger: "ctxDanger",
};

type Props = {
  sessionId: string | null;
  running: boolean;
};

/**
 * 上下文占用环 + 明细浮层（消息数、工具数、技能数、压缩按钮）。
 * 数据全部来自 store，避免把十几个派生值再塞回 Composer。
 */
export function ComposerContextMeter({ sessionId, running }: Props) {
  const t = useI18n();
  const messageApi = useMessage();
  const contextUsage = useSessionsStore((s) => s.activeContextUsage);
  const chatMessageCount = useChatStore((s) => s.activeMessages.length);
  const chatToolCount = useChatStore((s) => {
    const messages = s.activeMessages.filter((m) => m.role === "tool").length;
    const streaming = s.activeStreaming?.role === "tool" ? 1 : 0;
    return messages + streaming;
  });
  const showCompactButton = useAppearanceStore((s) => s.showCompactButton);

  const ctxPopoverOpen = useLatest(false);
  const compactBusy = useLatest(false);
  const skillsCount = useLatest<number | null>(null);
  const skillsCountCachedForRef = useRef<string | null>(null);

  /** 上下文占用率：环形图、色调、% Full 与分段条共用同一个窗口口径。 */
  const contextPercent = contextPercentOf(contextUsage);
  const contextTone = contextToneOf(contextPercent);
  const contextRingStyle = contextRingDash(contextPercent);
  const contextMessageCount = contextUsage?.messageCount ?? chatMessageCount;
  const contextToolCount = (() => {
    const fromStats = contextUsage?.toolCalls;
    if (typeof fromStats === "number") return fromStats;
    return chatToolCount;
  })();
  const contextCostLabel = contextCostLabelOf(contextUsage);
  const contextNeedsCompact = contextNeedsCompactAt(contextPercent);
  const contextSegments = contextSegmentsOf(contextUsage);
  const contextFreePct = contextFreePctOf(contextUsage);
  const contextFullLabel = contextFullLabelOf(contextPercent);
  const contextTokensPairLabel = contextTokensPairLabelOf(contextUsage);

  async function loadSkillsCount(): Promise<void> {
    const root = useWorkspaceStore.getState().root ?? "";
    if (skillsCountCachedForRef.current === root && skillsCount.value !== null) return;
    try {
      const data = await window.api.skills.list(
        useWorkspaceStore.getState().root ?? undefined,
      );
      skillsCount.set(data.skills?.length ?? 0);
      skillsCountCachedForRef.current = root;
    } catch {
      skillsCount.set(null);
    }
  }

  async function onCompactContext(): Promise<void> {
    const idSession = useSessionsStore.getState().activeId;
    if (!idSession || compactBusy.value) return;
    compactBusy.set(true);
    try {
      await useSessionsStore.getState().sendCommand(idSession, { type: "compact" });
      messageApi.success(t.compactDone);
      ctxPopoverOpen.set(false);
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : String(err));
    } finally {
      compactBusy.set(false);
    }
  }

  const content = (
    <div className={styles.ctxPopover}>
      <div className={styles.ctxPopSummary}>
        <span className={styles.ctxPopFull}>{contextFullLabel}</span>
        <span className={styles.ctxPopPair}>{contextTokensPairLabel}</span>
        {contextCostLabel ? (
          <span className={styles.ctxPopCost}>
            <span className={styles.ctxPopCostLabel}>{t.contextUsageCost}</span>
            {contextCostLabel}
          </span>
        ) : null}
      </div>
      <div className={styles.ctxBar} aria-hidden="true">
        {contextSegments.map((seg) => (
          <span
            key={seg.id}
            className={styles.ctxBarSeg}
            style={{ width: `${seg.widthPct}%`, background: seg.color }}
            title={`${seg.label}: ${seg.tokensLabel}`}
          />
        ))}
        {contextFreePct > 0.5 ? (
          <span className={styles.ctxBarSegFree} style={{ width: `${contextFreePct}%` }} />
        ) : null}
      </div>
      {contextSegments.length ? (
        <div className={styles.ctxLegend}>
          {contextSegments.map((seg) => (
            <div key={`leg-${seg.id}`} className={styles.ctxLegendRow}>
              <span className={styles.ctxSwatch} style={{ background: seg.color }} />
              <span className={styles.ctxLegendLabel}>{seg.label}</span>
              <strong>{seg.tokensLabel}</strong>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.ctxPopHint}>{t.contextUsageEmpty}</div>
      )}
      <div className={styles.ctxPopMeta}>
        <div className={styles.ctxPopRow}>
          <span>{t.contextUsageMessages}</span>
          <strong>{contextMessageCount}</strong>
        </div>
        <div className={styles.ctxPopRow}>
          <span>{t.contextUsageTools}</span>
          <strong>{contextToolCount}</strong>
        </div>
        <div className={styles.ctxPopRow}>
          <span>{t.contextUsageSkills}</span>
          <strong>{skillsCount.value ?? "—"}</strong>
        </div>
      </div>
      {showCompactButton ? (
        <Button
          size="small"
          block
          className={`${styles.ctxCompactBtn} ${
            contextNeedsCompact ? styles.ctxCompactUrgent : ""
          }`}
          disabled={!sessionId || running || compactBusy.value}
          loading={compactBusy.value}
          onClick={() => void onCompactContext()}
        >
          {contextNeedsCompact ? <span className={styles.ctxCompactDot} /> : null}
          {t.compactContext}
        </Button>
      ) : null}
    </div>
  );

  return (
    <Popover
      open={ctxPopoverOpen.value}
      onOpenChange={(next) => {
        ctxPopoverOpen.set(next);
        if (next) void loadSkillsCount();
      }}
      trigger="click"
      placement="topRight"
      content={content}
    >
      <button
        type="button"
        className={`${styles.ctxMeter} ${styles[TONE_CLASS[contextTone]] ?? ""}`}
        disabled={!sessionId}
        title={t.contextUsageTitle}
        aria-label={t.contextUsageTitle}
      >
        <svg
          className={styles.ctxRing}
          width="18"
          height="18"
          viewBox="0 0 18 18"
          aria-hidden="true"
        >
          <circle
            className={styles.ctxRingTrack}
            cx="9"
            cy="9"
            r="7"
            fill="none"
            strokeWidth="2"
          />
          <circle
            className={styles.ctxRingFill}
            cx="9"
            cy="9"
            r="7"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            transform="rotate(-90 9 9)"
            style={contextRingStyle}
          />
        </svg>
      </button>
    </Popover>
  );
}

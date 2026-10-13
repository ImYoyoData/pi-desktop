/**
 * 上下文窗口的派生指标 —— 纯函数，使环形图/分段条/紧凑阈值可脱离 Vue 单测。
 */

import type {
  ContextUsageSegmentId,
  SessionContextUsage,
} from "../../../shared/protocol";
import { t } from "@renderer/i18n";
import { formatSessionCost, isPositiveStat } from "./session-stats";

export type ContextTone = "muted" | "ok" | "warn" | "danger";

export type ContextSegmentView = {
  id: ContextUsageSegmentId;
  tokens: number;
  label: string;
  color: string;
  widthPct: number;
  tokensLabel: string;
};

const SEGMENT_META: Record<
  ContextUsageSegmentId,
  { color: string; label: () => string }
> = {
  system: { color: "var(--ctx-system)", label: () => t.contextUsageSegSystem },
  tools: { color: "var(--ctx-tools)", label: () => t.contextUsageSegTools },
  summarized: { color: "var(--ctx-summarized)", label: () => t.contextUsageSegSummarized },
  conversation: { color: "var(--ctx-conversation)", label: () => t.contextUsageSegConversation },
  toolResults: { color: "var(--ctx-tool-results)", label: () => t.contextUsageSegToolResults },
};

/** 手动压缩的触发线：真实窗口的 70%。 */
export const CONTEXT_COMPACT_PCT = 70;

export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

/**
 * 真实上下文占用率（占模型实际窗口的比例）。
 * 环形图、色调与「% Full」共用这个值，与分段条宽度口径一致。
 * tokens 或窗口缺失/非法时返回 null。
 */
export function contextPercentOf(usage: SessionContextUsage | null): number | null {
  const tokens = usage?.tokens;
  const window = usage?.contextWindow;
  if (tokens == null || !Number.isFinite(tokens) || tokens <= 0) return null;
  if (!window || !Number.isFinite(window) || window <= 0) return null;
  return Math.max(0, Math.min(100, (tokens / window) * 100));
}

export function contextToneOf(pct: number | null): ContextTone {
  if (pct == null) return "muted";
  if (pct > 90) return "danger";
  if (pct > 70) return "warn";
  return "ok";
}

export function contextRingDash(pct: number | null): {
  strokeDasharray: string;
  strokeDashoffset: string;
} {
  const r = 7;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - (pct ?? 0) / 100);
  return { strokeDasharray: `${c}`, strokeDashoffset: `${offset}` };
}

/** At 或 past the manual-compact line (70% of the real window). */
export function contextNeedsCompactAt(pct: number | null): boolean {
  return pct != null && pct >= CONTEXT_COMPACT_PCT;
}

export function contextSegmentsOf(usage: SessionContextUsage | null): ContextSegmentView[] {
  const window = usage?.contextWindow ?? 0;
  const segs = usage?.segments ?? [];
  if (!window || !segs.length) return [];
  return segs.map((s) => {
    const meta = SEGMENT_META[s.id];
    return {
      id: s.id,
      tokens: s.tokens,
      label: meta?.label() ?? s.id,
      color: meta?.color ?? "var(--fg-faint)",
      // 极窄分段也要留一丝可见宽度，否则图例与条形对不上。
      widthPct: Math.max(0.4, (s.tokens / window) * 100),
      tokensLabel: formatTokens(s.tokens),
    };
  });
}

export function contextFreePctOf(usage: SessionContextUsage | null): number {
  if (!usage?.contextWindow) return 100;
  const used =
    typeof usage.tokens === "number"
      ? usage.tokens
      : (usage.segments ?? []).reduce((n, s) => n + s.tokens, 0);
  return Math.max(0, 100 - (used / usage.contextWindow) * 100);
}

export function contextFullLabelOf(pct: number | null): string {
  if (pct == null) return t.contextUsageUnknown;
  return t.contextUsageFull(pct.toFixed(0));
}

export function contextTokensPairLabelOf(usage: SessionContextUsage | null): string {
  if (!usage) return t.contextUsageEmpty;
  const used = usage.tokens !== null ? formatTokens(usage.tokens) : "?";
  return t.contextUsageTokensPair(used, formatTokens(usage.contextWindow));
}

/** 会话累计 LLM 成本（Pi getSessionStats）；无数据时返回空串。 */
export function contextCostLabelOf(usage: SessionContextUsage | null): string {
  const cost = usage?.costUsd;
  return isPositiveStat(cost) ? formatSessionCost(cost) : "";
}
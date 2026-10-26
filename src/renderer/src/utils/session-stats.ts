/**
 * 会话统计面板的展示项 —— 纯函数，可直接单测格式化边界。
 *
 * 之前是 Composer 里一个 140 行的 computed 加上 8 个格式化函数，
 * 与虚拟滚动无关但同样无法脱离 Vue 验证。
 */

import type { SessionContextUsage } from "../../../shared/protocol";
import { t } from "@renderer/i18n";

export type SessionStatItem = {
  key: string;
  label: string;
  value: string;
  title?: string;
};

/** TPS 口径：streaming 只算首字后的流式生成段，end-to-end 含首字延迟在内的整段请求。 */
export type SessionTpsMode = "streaming" | "end-to-end";

/** 统计项只渲染有数据的：null、非有限值与零值一律视为无数据。 */
export function isPositiveStat(n: number | null | undefined): boolean {
  return n != null && Number.isFinite(n) && n > 0;
}

export function formatNum(n: number | null | undefined): string {
  return n == null ? "—" : String(n);
}

export function formatSessionTps(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  return t.sessionStatsTpsFormat(n >= 100 ? n.toFixed(0) : n.toFixed(1));
}

export function formatSessionCacheHit(p: number | null | undefined): string {
  if (p == null) return "—";
  return t.sessionStatsCacheHitFormat(String(p));
}

export function formatSessionTtft(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatSessionCost(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd) || usd <= 0) return "—";
  return `$${usd.toFixed(2)}`;
}

export function formatSessionDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const restMin = totalMin % 60;
  return restMin ? `${hours}h ${restMin}m` : `${hours}h`;
}

export function formatSessionTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "—";
  if (n >= 1_000_000) return t.sessionStatsTokensFormat(`${(n / 1_000_000).toFixed(1)}M`);
  return t.sessionStatsTokensFormat(n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
}

/** 按口径取 TPS：端到端用输出 token 除以 LLM 总时长，流式用 worker 直接给出的生成速度。 */
export function sessionTps(u: SessionContextUsage, mode: SessionTpsMode): number | null {
  if (mode !== "end-to-end") return u.tokensPerSecond ?? null;
  const output = u.outputTokens ?? 0;
  const totalMs = u.llmDurationMs ?? 0;
  if (output <= 0 || totalMs <= 0) return null;
  return output / (totalMs / 1000);
}

/** 统计项按固定顺序产出，跳过无数据的项；全部无数据时返回 null。 */
export function buildSessionStats(
  u: SessionContextUsage | null,
  tpsMode: SessionTpsMode = "streaming",
): SessionStatItem[] | null {
  if (!u) return null;
  const tps = sessionTps(u, tpsMode);
  const items: SessionStatItem[] = [];
  const push = (item: SessionStatItem | null): void => {
    if (item) items.push(item);
  };
  push(
    isPositiveStat(u.turns)
      ? {
          key: "turns",
          label: t.sessionStatsTurns,
          value: formatNum(u.turns),
          title: t.sessionStatsTitle(
            formatNum(u.turns),
            formatNum(u.steps ?? null),
            formatNum(u.toolCalls ?? null),
          ),
        }
      : null,
  );
  push(
    isPositiveStat(u.steps)
      ? { key: "steps", label: t.sessionStatsSteps, value: formatNum(u.steps) }
      : null,
  );
  push(
    isPositiveStat(u.toolCalls)
      ? { key: "tools", label: t.sessionStatsToolCalls, value: formatNum(u.toolCalls) }
      : null,
  );
  push(
    isPositiveStat(u.messageCount)
      ? { key: "messages", label: t.sessionStatsMessages, value: formatNum(u.messageCount) }
      : null,
  );
  push(
    isPositiveStat(tps)
      ? {
          key: "tps",
          label: t.sessionStatsTps,
          value: formatSessionTps(tps),
        }
      : null,
  );
  push(
    isPositiveStat(u.ttftMs) && isPositiveStat(u.ttftSteps)
      ? { key: "ttft", label: t.sessionStatsTtft, value: formatSessionTtft(u.ttftMs) }
      : null,
  );
  const cacheTotal =
    (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0);
  push(
    isPositiveStat(u.cacheReadTokens) && cacheTotal > 0
      ? {
          key: "cacheHit",
          label: t.sessionStatsCacheHit,
          value: formatSessionCacheHit(
            Math.min(100, Math.round(((u.cacheReadTokens ?? 0) / cacheTotal) * 100)),
          ),
        }
      : null,
  );
  push(
    isPositiveStat(u.cacheReadTokens)
      ? {
          key: "cacheRead",
          label: t.sessionStatsCacheRead,
          value: formatSessionTokens(u.cacheReadTokens),
        }
      : null,
  );
  push(
    isPositiveStat(u.cacheWriteTokens)
      ? {
          key: "cacheWrite",
          label: t.sessionStatsCacheWrite,
          value: formatSessionTokens(u.cacheWriteTokens),
        }
      : null,
  );
  push(
    isPositiveStat(u.inputTokens)
      ? {
          key: "input",
          label: t.sessionStatsInputTokens,
          value: formatSessionTokens(u.inputTokens),
        }
      : null,
  );
  push(
    isPositiveStat(u.outputTokens)
      ? {
          key: "output",
          label: t.sessionStatsOutputTokens,
          value: formatSessionTokens(u.outputTokens),
        }
      : null,
  );
  push(
    isPositiveStat(u.costUsd)
      ? { key: "cost", label: t.sessionStatsCost, value: formatSessionCost(u.costUsd) }
      : null,
  );
  push(
    isPositiveStat(u.llmDurationMs)
      ? {
          key: "duration",
          label: t.sessionStatsDuration,
          value: formatSessionDuration(u.llmDurationMs),
        }
      : null,
  );
  return items.length > 0 ? items : null;
}
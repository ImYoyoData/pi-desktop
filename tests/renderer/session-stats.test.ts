import { describe, expect, it } from "vitest";
import {
  buildSessionStats,
  formatNum,
  formatSessionCacheHit,
  formatSessionCost,
  formatSessionDuration,
  formatSessionTps,
  formatSessionTokens,
  formatSessionTtft,
  isPositiveStat,
  sessionTps,
  sessionUsageFromMessages,
} from "../../src/renderer/src/utils/session-stats";
import { t } from "../../src/renderer/src/i18n";
import type { SessionContextUsage } from "../../src/shared/protocol";

function usage(partial: Partial<SessionContextUsage>): SessionContextUsage {
  return {
    tokens: 0,
    contextWindow: 200_000,
    percent: 0,
    ...partial,
  };
}

describe("isPositiveStat", () => {
  it("treats null, non-finite and non-positive as no data", () => {
    expect(isPositiveStat(null)).toBe(false);
    expect(isPositiveStat(undefined)).toBe(false);
    expect(isPositiveStat(0)).toBe(false);
    expect(isPositiveStat(-1)).toBe(false);
    expect(isPositiveStat(Number.NaN)).toBe(false);
    expect(isPositiveStat(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("accepts positive finite values", () => {
    expect(isPositiveStat(1)).toBe(true);
    expect(isPositiveStat(0.5)).toBe(true);
  });
});

describe("formatNum", () => {
  it("renders a dash only for null", () => {
    expect(formatNum(null)).toBe("—");
    expect(formatNum(0)).toBe("0");
    expect(formatNum(12)).toBe("12");
  });
});

describe("formatSessionTps", () => {
  it("drops decimals at or above 100", () => {
    expect(formatSessionTps(99.44)).toContain("99.4");
    expect(formatSessionTps(123.6)).toContain("124");
  });

  it("falls back to a dash without data", () => {
    expect(formatSessionTps(null)).toBe("—");
    expect(formatSessionTps(0)).toBe("—");
  });

  it("goes through the locale string", () => {
    expect(formatSessionTps(12.5)).toBe(t.sessionStatsTpsFormat("12.5"));
  });
});

describe("formatSessionTtft", () => {
  it("uses ms below one second and seconds above", () => {
    expect(formatSessionTtft(120)).toBe("120ms");
    expect(formatSessionTtft(999)).toBe("999ms");
    expect(formatSessionTtft(1_500)).toBe("1.5s");
  });

  it("falls back to a dash without data", () => {
    expect(formatSessionTtft(0)).toBe("—");
    expect(formatSessionTtft(Number.NaN)).toBe("—");
  });
});

describe("formatSessionCost", () => {
  it("formats two decimals with a dollar sign", () => {
    expect(formatSessionCost(1.5)).toBe("$1.50");
    // 判据是原值 > 0，四舍五入后为 0 仍会显示。
    expect(formatSessionCost(0.004)).toBe("$0.00");
    expect(formatSessionCost(0)).toBe("—");
  });
});

describe("formatSessionDuration", () => {
  it("scales seconds, minutes and hours", () => {
    expect(formatSessionDuration(45_000)).toBe("45s");
    // 分钟级只显示整分钟，余秒仅在小时级才展开；满 60 分钟即进小时分支。
    expect(formatSessionDuration(90_000)).toBe("1m");
    expect(formatSessionDuration(3_599_000)).toBe("59m");
    expect(formatSessionDuration(3_600_000)).toBe("1h");
    expect(formatSessionDuration(3_661_000)).toBe("1h 1m");
    expect(formatSessionDuration(7_200_000)).toBe("2h");
  });
});

describe("formatSessionTokens", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatSessionTokens(999)).toBe(t.sessionStatsTokensFormat("999"));
    expect(formatSessionTokens(1_500)).toBe(t.sessionStatsTokensFormat("1.5k"));
    expect(formatSessionTokens(2_000_000)).toBe(t.sessionStatsTokensFormat("2.0M"));
  });

  it("allows zero but rejects negatives", () => {
    expect(formatSessionTokens(0)).toBe(t.sessionStatsTokensFormat("0"));
    expect(formatSessionTokens(-1)).toBe("—");
  });
});

describe("formatSessionCacheHit", () => {
  it("passes the percentage through the locale string", () => {
    expect(formatSessionCacheHit(42)).toBe(t.sessionStatsCacheHitFormat("42"));
    expect(formatSessionCacheHit(null)).toBe("—");
  });
});

describe("sessionTps", () => {
  const timing = usage({ tokensPerSecond: 90, outputTokens: 2_500, llmDurationMs: 50_000 });

  it("keeps the worker streaming throughput for the streaming basis", () => {
    expect(sessionTps(timing, "streaming")).toBe(90);
  });

  it("divides output tokens by total LLM time for the end-to-end basis", () => {
    expect(sessionTps(timing, "end-to-end")).toBe(50);
  });

  it("needs both tokens and duration for the end-to-end basis", () => {
    expect(sessionTps(usage({ outputTokens: 100 }), "end-to-end")).toBeNull();
    expect(sessionTps(usage({ llmDurationMs: 1_000 }), "end-to-end")).toBeNull();
  });
});

describe("buildSessionStats", () => {
  it("returns null without usage", () => {
    expect(buildSessionStats(null)).toBeNull();
  });

  it("returns null when nothing has data", () => {
    expect(buildSessionStats(usage({}))).toBeNull();
  });

  it("emits only the stats that carry data, in a stable order", () => {
    const items = buildSessionStats(
      usage({
        turns: 3,
        steps: 12,
        toolCalls: 5,
        messageCount: 40,
        tokensPerSecond: 88.4,
        inputTokens: 1_000,
        outputTokens: 2_500,
        costUsd: 0.42,
        llmDurationMs: 65_000,
      }),
    );
    expect(items?.map((i) => i.key)).toEqual([
      "turns",
      "steps",
      "tools",
      "messages",
      "tps",
      "input",
      "output",
      "cost",
      "duration",
    ]);
  });

  it("attaches a title only to the turns row", () => {
    const items = buildSessionStats(usage({ turns: 3, steps: 12 }));
    expect(items?.find((i) => i.key === "turns")?.title).toBe(
      t.sessionStatsTitle("3", "12", "—"),
    );
    expect(items?.find((i) => i.key === "steps")?.title).toBeUndefined();
  });

  it("needs both ttft fields before showing ttft", () => {
    expect(
      buildSessionStats(usage({ ttftMs: 500 }))?.some((i) => i.key === "ttft") ?? false,
    ).toBe(false);
    const items = buildSessionStats(usage({ ttftMs: 500, ttftSteps: 2 }));
    expect(items?.find((i) => i.key === "ttft")?.value).toBe("500ms");
  });

  it("uses the selected TPS basis", () => {
    const stats = usage({ tokensPerSecond: 90, outputTokens: 2_500, llmDurationMs: 50_000 });
    expect(buildSessionStats(stats, "end-to-end")?.find((i) => i.key === "tps")?.value).toBe(
      t.sessionStatsTpsFormat("50.0"),
    );
  });

  it("caps the cache-hit ratio at 100 and needs a positive read", () => {
    const items = buildSessionStats(
      usage({ cacheReadTokens: 3_000, inputTokens: 0, cacheWriteTokens: 0 }),
    );
    expect(items?.find((i) => i.key === "cacheHit")?.value).toBe(
      t.sessionStatsCacheHitFormat("100"),
    );
    expect(
      buildSessionStats(usage({ inputTokens: 500 }))?.some((i) => i.key === "cacheHit"),
    ).toBe(false);
  });
});
describe("sessionUsageFromMessages", () => {
  it("returns null for an empty history", () => {
    expect(sessionUsageFromMessages([])).toBeNull();
  });

  it("counts roles and sums billed tokens", () => {
    const usage = sessionUsageFromMessages([
      { role: "user" },
      { role: "assistant", usage: { input: 100, output: 20 } },
      { role: "tool" },
      { role: "assistant", usage: { input: 50, output: 10 } },
    ]);
    expect(usage).toMatchObject({
      turns: 1,
      steps: 2,
      toolCalls: 1,
      messageCount: 4,
      inputTokens: 150,
      outputTokens: 30,
      tokens: null,
      contextWindow: 0,
    });
  });

  it("leaves token totals null when the history carries no usage", () => {
    const usage = sessionUsageFromMessages([{ role: "user" }]);
    expect(usage?.inputTokens).toBeNull();
    expect(usage?.outputTokens).toBeNull();
  });
});

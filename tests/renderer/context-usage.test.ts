import { describe, expect, it } from "vitest";
import {
  CONTEXT_COMPACT_PCT,
  contextCostLabelOf,
  contextFreePctOf,
  contextFullLabelOf,
  contextNeedsCompactAt,
  contextPercentOf,
  contextRingDash,
  contextSegmentsOf,
  contextTokensPairLabelOf,
  contextToneOf,
  formatTokens,
} from "../../src/renderer/src/utils/context-usage";
import { t } from "../../src/renderer/src/i18n";
import type { SessionContextUsage } from "../../src/shared/protocol";

function usage(partial: Partial<SessionContextUsage>): SessionContextUsage {
  return { tokens: 0, contextWindow: 200_000, percent: 0, ...partial };
}

describe("formatTokens", () => {
  it("keeps small counts verbatim", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("uses one decimal under 10k and whole k above", () => {
    expect(formatTokens(1_500)).toBe("1.5k");
    expect(formatTokens(9_999)).toBe("10.0k");
    expect(formatTokens(12_345)).toBe("12k");
  });

  it("switches to millions with the same two-step rule", () => {
    expect(formatTokens(1_500_000)).toBe("1.5M");
    expect(formatTokens(12_345_678)).toBe("12M");
  });
});

describe("contextPercentOf", () => {
  it("computes tokens over the real window", () => {
    expect(contextPercentOf(usage({ tokens: 50_000 }))).toBe(25);
  });

  it("returns null when tokens or the window are missing or invalid", () => {
    expect(contextPercentOf(null)).toBeNull();
    expect(contextPercentOf(usage({ tokens: null }))).toBeNull();
    expect(contextPercentOf(usage({ tokens: 0 }))).toBeNull();
    expect(contextPercentOf(usage({ tokens: 100, contextWindow: 0 }))).toBeNull();
    expect(contextPercentOf(usage({ tokens: Number.NaN }))).toBeNull();
  });

  it("clamps into [0, 100]", () => {
    expect(contextPercentOf(usage({ tokens: 400_000 }))).toBe(100);
    expect(contextPercentOf(usage({ tokens: -5 }))).toBeNull();
  });
});

describe("contextToneOf", () => {
  it("escalates at the documented thresholds", () => {
    expect(contextToneOf(null)).toBe("muted");
    expect(contextToneOf(10)).toBe("ok");
    expect(contextToneOf(70)).toBe("ok");
    expect(contextToneOf(71)).toBe("warn");
    expect(contextToneOf(90)).toBe("warn");
    expect(contextToneOf(91)).toBe("danger");
  });
});

describe("contextNeedsCompactAt", () => {
  it("fires at the compact line", () => {
    expect(contextNeedsCompactAt(CONTEXT_COMPACT_PCT)).toBe(true);
    expect(contextNeedsCompactAt(CONTEXT_COMPACT_PCT - 0.1)).toBe(false);
    expect(contextNeedsCompactAt(null)).toBe(false);
  });
});

describe("contextRingDash", () => {
  it("treats an unknown percent as an empty ring", () => {
    expect(contextRingDash(null).strokeDashoffset).toBe(contextRingDash(0).strokeDashoffset);
  });

  it("offsets proportionally to the fill", () => {
    const full = contextRingDash(100);
    const half = contextRingDash(50);
    expect(Number(full.strokeDashoffset)).toBe(0);
    expect(Number(half.strokeDashoffset)).toBeGreaterThan(0);
  });
});

describe("contextSegmentsOf", () => {
  it("returns nothing without a window or segments", () => {
    expect(contextSegmentsOf(null)).toEqual([]);
    expect(contextSegmentsOf(usage({}))).toEqual([]);
    expect(contextSegmentsOf(usage({ contextWindow: 0, segments: [{ id: "system", tokens: 10 }] }))).toEqual([]);
  });

  it("maps ids to color, label and width", () => {
    const segs = contextSegmentsOf(
      usage({
        segments: [
          { id: "system", tokens: 20_000 },
          { id: "conversation", tokens: 180_000 },
        ],
      }),
    );
    expect(segs[0]?.color).toBe("var(--ctx-system)");
    expect(segs[0]?.widthPct).toBe(10);
    expect(segs[0]?.tokensLabel).toBe("20k");
    expect(segs[1]?.label).toBe(t.contextUsageSegConversation);
  });

  it("keeps a visible width floor for tiny segments", () => {
    const segs = contextSegmentsOf(usage({ segments: [{ id: "system", tokens: 1 }] }));
    expect(segs[0]?.widthPct).toBe(0.4);
  });
});

describe("contextFreePctOf", () => {
  it("sums segments when tokens are absent", () => {
    const u = usage({
      tokens: null,
      segments: [
        { id: "system", tokens: 20_000 },
        { id: "tools", tokens: 30_000 },
      ],
    });
    expect(contextFreePctOf(u)).toBe(75);
  });

  it("reports a full window when nothing is known", () => {
    expect(contextFreePctOf(null)).toBe(100);
    expect(contextFreePctOf(usage({ contextWindow: 0 }))).toBe(100);
  });

  it("never goes negative", () => {
    expect(contextFreePctOf(usage({ tokens: 500_000 }))).toBe(0);
  });
});

describe("contextFullLabelOf", () => {
  it("marks an unknown window", () => {
    expect(contextFullLabelOf(null)).toBe(t.contextUsageUnknown);
  });

  it("rounds the percent for display", () => {
    expect(contextFullLabelOf(66.6)).toBe(t.contextUsageFull("67"));
  });
});

describe("contextTokensPairLabelOf", () => {
  it("marks an empty session", () => {
    expect(contextTokensPairLabelOf(null)).toBe(t.contextUsageEmpty);
  });

  it("shows a question mark when tokens are unknown but the window is not", () => {
    expect(contextTokensPairLabelOf(usage({ tokens: null }))).toBe(
      t.contextUsageTokensPair("?", "200k"),
    );
  });
});

describe("contextCostLabelOf", () => {
  it("is empty without a positive cost", () => {
    expect(contextCostLabelOf(null)).toBe("");
    expect(contextCostLabelOf(usage({}))).toBe("");
  });

  it("formats a positive cost", () => {
    expect(contextCostLabelOf(usage({ costUsd: 1.5 }))).toBe("$1.50");
  });
});
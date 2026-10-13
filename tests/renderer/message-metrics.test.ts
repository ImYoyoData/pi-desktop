import { describe, expect, it } from "vitest";
import {
  assistantModelDetail,
  assistantStats,
  buildModelNameMap,
  formatElapsedMs,
  formatTokenCount,
  toolStatus,
  type AssistantMessage,
  type ToolMessage,
} from "../../src/renderer/src/utils/message-metrics";
import { t } from "../../src/renderer/src/i18n";
import type { SessionContextUsage } from "../../src/shared/protocol";

function assistant(partial: Partial<AssistantMessage>): AssistantMessage {
  return { id: "a1", role: "assistant", text: "hi", ...partial };
}

function tool(partial: Partial<ToolMessage>): ToolMessage {
  return { id: "t1", role: "tool", toolCallId: "t1", toolName: "bash", ...partial };
}

function ctx(partial: Partial<SessionContextUsage>): SessionContextUsage {
  return { tokens: 0, contextWindow: 0, percent: 0, ...partial };
}

describe("formatElapsedMs", () => {
  it("uses seconds below a minute", () => {
    expect(formatElapsedMs(12_400)).toBe("12.4s");
    expect(formatElapsedMs(59_900)).toBe("59.9s");
  });

  it("switches to minutes and keeps remaining seconds", () => {
    expect(formatElapsedMs(61_000)).toBe("1m 1s");
    expect(formatElapsedMs(3_600_000)).toBe("60m");
  });

  it("drops whole minutes that round to zero", () => {
    expect(formatElapsedMs(120_000)).toBe("2m");
  });
});

describe("formatTokenCount", () => {
  it("keeps small counts verbatim", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(999)).toBe("999");
  });

  it("abbreviates thousands and millions", () => {
    expect(formatTokenCount(1_200)).toBe("1.2k");
    expect(formatTokenCount(1_000_000)).toBe("1.0M");
  });
});

describe("buildModelNameMap", () => {
  it("keys entries by provider/id", () => {
    const map = buildModelNameMap([
      { provider: "anthropic", id: "sonnet", name: "Claude Sonnet" },
    ]);
    expect(map["anthropic/sonnet"]).toBe("Claude Sonnet");
  });
});

describe("assistantStats", () => {
  it("returns null when there is neither duration nor tokens", () => {
    expect(assistantStats(assistant({}))).toBeNull();
  });

  it("shows duration and tokens with a per-second rate", () => {
    const stats = assistantStats(
      assistant({ durationMs: 10_000, usage: { totalTokens: 1_000 } as never }),
    );
    expect(stats?.compact).toBe("10.0s · 1.0k · 100/s");
  });

  it("omits the rate when duration is missing", () => {
    const stats = assistantStats(assistant({ usage: { totalTokens: 1_000 } as never }));
    expect(stats?.compact).toBe("1.0k");
  });

  it("omits tokens when usage is missing", () => {
    expect(assistantStats(assistant({ durationMs: 2_000 }))?.compact).toBe("2.0s");
  });
});

describe("assistantModelDetail", () => {
  const modelNames = { "anthropic/sonnet": "Claude Sonnet" };

  it("resolves the display name from the model directory", () => {
    const detail = assistantModelDetail(
      assistant({ model: { provider: "anthropic", id: "sonnet" } }),
      null,
      modelNames,
    );
    expect(detail?.compact).toBe("Claude Sonnet");
  });

  it("falls back to the raw model id when the directory misses it", () => {
    const detail = assistantModelDetail(
      assistant({ model: { provider: "x", id: "y" } }),
      null,
      modelNames,
    );
    expect(detail?.compact).toBe("y");
  });

  it("appends the thinking level and omits it when off", () => {
    expect(
      assistantModelDetail(
        assistant({ model: { provider: "x", id: "y" }, thinkingLevel: "high" }),
        null,
        {},
      )?.compact,
    ).toBe("y · High");
    expect(
      assistantModelDetail(
        assistant({ model: { provider: "x", id: "y" }, thinkingLevel: "off" }),
        null,
        {},
      )?.compact,
    ).toBe("y");
  });

  it("falls back to session context usage when the row has none", () => {
    const detail = assistantModelDetail(
      assistant({}),
      ctx({ model: { provider: "anthropic", id: "sonnet" } }),
      modelNames,
    );
    expect(detail?.compact).toBe("Claude Sonnet");
  });

  it("returns null when neither model nor level is known", () => {
    expect(assistantModelDetail(assistant({}), null, {})).toBeNull();
  });
});

describe("toolStatus", () => {
  it("reports running while streaming", () => {
    expect(toolStatus(tool({ streaming: true })).label).toBe(t.toolRunning);
  });

  it("reports error and success otherwise", () => {
    expect(toolStatus(tool({ isError: true })).label).toBe(t.toolError);
    expect(toolStatus(tool({})).label).toBe(t.toolDone);
  });
});
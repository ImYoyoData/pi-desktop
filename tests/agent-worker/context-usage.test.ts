import { describe, expect, it } from "vitest";
import { readContextUsage } from "../../src/agent-worker/context-usage";

describe("context-usage breakdown", () => {
  it("builds stacked segments from system/tools/messages", () => {
    const active = {
      systemPrompt: "x".repeat(400), // ~100 tokens
      getAllTools: () => [
        {
          name: "bash",
          description: "y".repeat(200),
          parameters: { type: "object" },
          promptGuidelines: ["z".repeat(100)],
        },
      ],
      messages: [
        { role: "user", content: "hello ".repeat(50) },
        {
          role: "assistant",
          content: [
            { type: "text", text: "world ".repeat(40) },
            { type: "toolCall", name: "bash", arguments: { cmd: "ls" } },
          ],
        },
        {
          role: "toolResult",
          content: [{ type: "text", text: "ok ".repeat(80) }],
        },
        { role: "compactionSummary", summary: "sum ".repeat(30) },
      ],
      getSessionStats: () => ({
        toolCalls: 1,
        userMessages: 1,
        assistantMessages: 1,
        toolResults: 1,
      }),
      getContextUsage: () => ({
        tokens: 500,
        contextWindow: 2000,
        percent: 25,
      }),
      model: { contextWindow: 2000 },
    };

    const usage = readContextUsage(active as never);
    expect(usage).toBeTruthy();
    expect(usage?.contextWindow).toBe(2000);
    expect(usage?.toolCalls).toBe(1);
    expect(usage?.segments?.some((s) => s.id === "system")).toBe(true);
    expect(usage?.segments?.some((s) => s.id === "tools")).toBe(true);
    expect(usage?.segments?.some((s) => s.id === "conversation")).toBe(true);
    expect(usage?.segments?.some((s) => s.id === "toolResults")).toBe(true);
    expect(usage?.segments?.some((s) => s.id === "summarized")).toBe(true);
    const sum = (usage?.segments ?? []).reduce((n, s) => n + s.tokens, 0);
    // Scaled so fixed(system+tools) + variable ≈ official tokens.
    expect(sum).toBeGreaterThan(0);
    expect(sum).toBeLessThanOrEqual(500 + 5);
  });
});

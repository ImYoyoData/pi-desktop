import { describe, expect, it } from "vitest";
import { readContextUsage } from "../../src/agent-worker/context-usage";

function makeMessage(role: string, parts: unknown[] = []): {
  role: string;
  content: unknown;
} {
  return { role, content: parts };
}

/**
 * Minimal AgentSession-shaped stub. `messages` feeds the token-estimate
 * segments; `sessionManager.getBranch()` feeds the active-branch turn/steps
 * counters; `getSessionStats()` is what the SDK returns over the WHOLE tree
 * (it over-counts when the session file holds abandoned branches).
 */
function makeActive(opts: {
  messages: unknown[];
  branch: unknown[];
  getSessionStats: () => {
    userMessages: number;
    assistantMessages: number;
    toolResults: number;
    toolCalls: number;
  };
}): unknown {
  return {
    systemPrompt: "",
    getAllTools: () => [],
    messages: opts.messages,
    sessionManager: { getBranch: () => opts.branch },
    getSessionStats: () => opts.getSessionStats(),
    getContextUsage: () => null,
    model: { contextWindow: 2000 },
  };
}

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

  it("counts turns/steps from the active branch, not the whole session tree", () => {
    // SDK totals include 3 abandoned user turns that still live in the file.
    const active = makeActive({
      messages: [
        makeMessage("user", [{ type: "text", text: "q" }]),
        makeMessage("assistant", [{ type: "text", text: "a" }]),
      ],
      // Active leaf path: exactly 2 real rounds.
      branch: [
        { type: "message", id: "u1", parentId: null, message: makeMessage("user", [{ type: "text", text: "q1" }]) },
        { type: "message", id: "a1", parentId: "u1", message: makeMessage("assistant", [{ type: "text", text: "a1" }, { type: "toolCall", name: "bash", arguments: {} }]) },
        { type: "message", id: "tr1", parentId: "a1", message: makeMessage("toolResult", [{ type: "text", text: "ok" }]) },
        { type: "message", id: "u2", parentId: "tr1", message: makeMessage("user", [{ type: "text", text: "q2" }]) },
        { type: "message", id: "a2", parentId: "u2", message: makeMessage("assistant", [{ type: "text", text: "a2" }]) },
      ],
      getSessionStats: () => ({
        // The SDK counts ALL entries incl. 3 orphaned users → would say 5.
        userMessages: 5,
        assistantMessages: 5,
        toolResults: 5,
        toolCalls: 7,
      }),
    });

    const usage = readContextUsage(active as never);
    expect(usage?.turns).toBe(2);
    expect(usage?.steps).toBe(2);
    expect(usage?.messageCount).toBe(5);
    expect(usage?.toolCalls).toBe(1);
  });

  it("falls back to SDK totals when no session manager branch is available", () => {
    const active = {
      messages: [
        { role: "user", content: "q" },
        { role: "assistant", content: [{ type: "text", text: "a" }] },
      ],
      getSessionStats: () => ({
        userMessages: 3,
        assistantMessages: 4,
        toolResults: 2,
        toolCalls: 6,
      }),
      getContextUsage: () => null,
      model: { contextWindow: 2000 },
    };
    const usage = readContextUsage(active as never);
    expect(usage?.turns).toBe(3);
    expect(usage?.steps).toBe(4);
    expect(usage?.toolCalls).toBe(6);
  });
});

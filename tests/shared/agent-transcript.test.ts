import { describe, expect, it } from "vitest";
import { normalizeAgentMessages } from "../../src/shared/agent-transcript";

describe("normalizeAgentMessages", () => {
  it("merges each tool call with its result", () => {
    const entries = normalizeAgentMessages([
      { role: "user", content: "修复登录", timestamp: 1 },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "先看代码" },
          { type: "text", text: "我来处理" },
          { type: "toolCall", id: "c1", name: "read", arguments: { path: "a.ts" } },
        ],
        timestamp: 2,
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "read",
        content: [{ type: "text", text: "line1" }],
        isError: false,
        timestamp: 3,
      },
    ]);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ kind: "message", role: "user", text: "修复登录" });
    expect(entries[1]).toMatchObject({
      kind: "message",
      role: "assistant",
      text: "我来处理",
      thinking: "先看代码",
    });
    expect(entries[2]).toMatchObject({
      kind: "tool",
      toolName: "read",
      args: '{"path":"a.ts"}',
      text: "line1",
    });
  });

  it("keeps an orphan tool result and clips long output", () => {
    const entries = normalizeAgentMessages([
      {
        role: "toolResult",
        toolCallId: "missing",
        toolName: "bash",
        content: [{ type: "text", text: "x".repeat(5000) }],
        isError: true,
      },
    ]);
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    if (!entry || entry.kind !== "tool") throw new Error("expected a tool entry");
    expect(entry.toolName).toBe("bash");
    expect(entry.isError).toBe(true);
    expect(entry.text?.endsWith("…")).toBe(true);
  });

  it("drops empty messages and unknown roles", () => {
    expect(
      normalizeAgentMessages([
        { role: "user", content: [] },
        { role: "assistant", content: [] },
        null,
        "not a message",
        { role: "summary", text: "ignored" },
      ]),
    ).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  parseBashToolCard,
  parseReadToolCard,
  parseToolCard,
} from "../../src/renderer/src/utils/tool-diff";
import { createChatState, reduceChatEvent } from "../../src/renderer/src/stores/chat-reducer";

describe("tool cards", () => {
  it("parses read card with lines read / total", () => {
    const card = parseReadToolCard(
      { path: "/tmp/a.ts", offset: 1 },
      {
        content: [{ type: "text", text: "line1\nline2\n\n[Showing lines 1-2 of 10. Use offset=3 to continue.]" }],
        details: {
          truncation: {
            truncated: true,
            outputLines: 2,
            totalLines: 10,
          },
        },
      },
    );
    expect(card.kind).toBe("read");
    expect(card.path).toContain("a.ts");
    expect(card.linesRead).toBe(2);
    expect(card.totalLines).toBe(10);
    expect(card.truncated).toBe(true);
  });

  it("parses bash command and line stats", () => {
    const card = parseBashToolCard(
      { command: "ls -la" },
      {
        content: [{ type: "text", text: "a\nb\nc" }],
        details: {
          truncation: { truncated: false, outputLines: 3, totalLines: 3 },
        },
      },
    );
    expect(card.kind).toBe("bash");
    expect(card.command).toBe("ls -la");
    expect(card.linesRead).toBe(3);
  });

  it("preserves args and order across tool start/end", () => {
    let state = createChatState();
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s1",
      event: {
        type: "tool_execution_start",
        toolCallId: "t1",
        toolName: "read",
        args: { path: "foo.ts" },
      },
    } as never);
    expect(state.streamingMessage?.role).toBe("tool");
    if (state.streamingMessage?.role === "tool") {
      expect(state.streamingMessage.order).toBe(1);
      expect(state.streamingMessage.args).toEqual({ path: "foo.ts" });
    }
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s1",
      event: {
        type: "tool_execution_end",
        toolCallId: "t1",
        toolName: "read",
        result: { content: [{ type: "text", text: "ok" }] },
        isError: false,
      },
    } as never);
    const tool = state.messages.find((m) => m.role === "tool");
    expect(tool?.role).toBe("tool");
    if (tool?.role === "tool") {
      expect(tool.args).toEqual({ path: "foo.ts" });
      expect(tool.order).toBe(1);
      expect(tool.isError).toBe(false);
    }
    expect(parseToolCard("read", tool && tool.role === "tool" ? tool.args : null, tool && tool.role === "tool" ? tool.result : null).kind).toBe(
      "read",
    );
  });
});

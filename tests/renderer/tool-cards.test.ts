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

  it("synthesizes write as an all-additions diff", () => {
    const card = parseToolCard(
      "write",
      { path: "src/new.ts", content: "a\nb\nc" },
      { content: [{ type: "text", text: "Wrote src/new.ts" }] },
    );
    expect(card.kind).toBe("write");
    if (card.kind !== "write") return;
    expect(card.stats).toEqual({ additions: 3, deletions: 0 });
    expect(card.diff).toContain("--- /dev/null");
    expect(card.diff).toContain("+++ b/src/new.ts");
    expect(card.diff).toContain("+a");
    expect(card.diff).toContain("+b");
    expect(card.diff).toContain("+c");
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

  it("does not duplicate assistant bubbles across repeated toolcall deltas", () => {
    let state = createChatState();
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s1",
      event: {
        type: "message_update",
        message: {
          id: "a1",
          role: "assistant",
          content: [
            { type: "thinking", thinking: "先查一下" },
            { type: "text", text: "读表工具返回空，让我用原始 SQL 查询。" },
          ],
        },
        assistantMessageEvent: { type: "text_delta", delta: "读表工具返回空，让我用原始 SQL 查询。" },
      },
    } as never);
    expect(state.streamingMessage?.role).toBe("assistant");

    const toolPartial = (content: string) =>
      ({
        type: "agent_event",
        sessionId: "s1",
        event: {
          type: "message_update",
          message: {
            id: "a1",
            role: "assistant",
            content: [
              { type: "thinking", thinking: "先查一下" },
              { type: "text", text: "读表工具返回空，让我用原始 SQL 查询。" },
              {
                type: "toolCall",
                id: "sql1",
                name: "bash",
                arguments: { command: content },
              },
            ],
          },
          assistantMessageEvent: {
            type: "toolcall_delta",
            contentIndex: 2,
            delta: content,
          },
        },
      }) as never;

    state = reduceChatEvent(state, toolPartial("SELECT 1"));
    state = reduceChatEvent(state, toolPartial("SELECT 1 FROM t"));
    state = reduceChatEvent(state, toolPartial("SELECT 1 FROM t WHERE id=1"));

    const assistants = state.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]).toMatchObject({
      id: "a1",
      text: "读表工具返回空，让我用原始 SQL 查询。",
      thinking: "先查一下",
      streaming: false,
    });
    expect(state.streamingMessage?.role).toBe("tool");
  });

  it("does not re-append assistant after tool end + text snapshot + next tool + message_end", () => {
    const assistantContent = [
      { type: "thinking", thinking: "想一下" },
      { type: "text", text: "先看看有哪些可用的子 agent。" },
    ];
    let state = createChatState();
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s1",
      event: {
        type: "message_update",
        message: { id: "a1", role: "assistant", content: assistantContent },
        assistantMessageEvent: { type: "text_delta", delta: "先看看有哪些可用的子 agent。" },
      },
    } as never);

    // First toolcall parks assistant
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s1",
      event: {
        type: "message_update",
        message: {
          id: "a1",
          role: "assistant",
          content: [
            ...assistantContent,
            { type: "toolCall", id: "t1", name: "subagent", arguments: { action: "list" } },
          ],
        },
        assistantMessageEvent: { type: "toolcall_delta", contentIndex: 2, delta: "{}" },
      },
    } as never);
    expect(state.messages.filter((m) => m.role === "assistant")).toHaveLength(1);

    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s1",
      event: {
        type: "tool_execution_end",
        toolCallId: "t1",
        toolName: "subagent",
        result: { content: [{ type: "text", text: "ok" }] },
        isError: false,
      },
    } as never);
    expect(state.streamingMessage).toBeNull();

    // Between tools Pi often re-sends the assistant snapshot WITHOUT toolCall parts —
    // this used to resurrect streamingMessage and re-commit on the next tool.
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s1",
      event: {
        type: "message_update",
        message: { id: "a1", role: "assistant", content: assistantContent },
        assistantMessageEvent: { type: "text_delta", delta: "" },
      },
    } as never);
    expect(state.streamingMessage?.role === "assistant").toBe(false);
    expect(state.messages.filter((m) => m.role === "assistant")).toHaveLength(1);

    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s1",
      event: {
        type: "message_update",
        message: {
          id: "a1",
          role: "assistant",
          content: [
            ...assistantContent,
            { type: "toolCall", id: "t2", name: "subagent", arguments: { action: "status" } },
          ],
        },
        assistantMessageEvent: { type: "toolcall_start", contentIndex: 2 },
      },
    } as never);
    expect(state.messages.filter((m) => m.role === "assistant")).toHaveLength(1);

    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s1",
      event: {
        type: "message_end",
        message: {
          id: "a1",
          role: "assistant",
          content: assistantContent,
          stopReason: "toolUse",
        },
      },
    } as never);
    expect(state.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
  });

  it("streams write tool args from toolcall_delta before execution ends", () => {
    let state = createChatState();
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s1",
      event: {
        type: "message_update",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "w1",
              name: "write",
              arguments: { path: "a.ts", content: "hel" },
            },
          ],
        },
        assistantMessageEvent: {
          type: "toolcall_delta",
          contentIndex: 0,
          delta: "hel",
        },
      },
    } as never);
    expect(state.streamingMessage?.role).toBe("tool");
    if (state.streamingMessage?.role === "tool") {
      expect(state.streamingMessage.toolName).toBe("write");
      expect(state.streamingMessage.args).toEqual({ path: "a.ts", content: "hel" });
      expect(state.streamingMessage.streaming).toBe(true);
    }

    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s1",
      event: {
        type: "message_update",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "w1",
              name: "write",
              arguments: { path: "a.ts", content: "hello\nworld" },
            },
          ],
        },
        assistantMessageEvent: {
          type: "toolcall_delta",
          contentIndex: 0,
          delta: "lo\nworld",
        },
      },
    } as never);
    if (state.streamingMessage?.role === "tool") {
      expect(state.streamingMessage.args).toEqual({
        path: "a.ts",
        content: "hello\nworld",
      });
    }

    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s1",
      event: {
        type: "tool_execution_end",
        toolCallId: "w1",
        toolName: "write",
        result: { content: [{ type: "text", text: "Wrote a.ts" }] },
        isError: false,
      },
    } as never);
    const tool = state.messages.find((m) => m.role === "tool");
    expect(tool?.role).toBe("tool");
    if (tool?.role === "tool") {
      expect(tool.args).toEqual({ path: "a.ts", content: "hello\nworld" });
      expect(tool.streaming).toBe(false);
    }
  });

  it("keeps every parallel tool card visible while streaming (no single-box flip)", () => {
    let state = createChatState();
    const ev = (event: Record<string, unknown>) =>
      (state = reduceChatEvent(state, {
        type: "agent_event",
        sessionId: "s1",
        event,
      } as never));

    // One assistant message streams two parallel edit calls (a.ts then b.ts).
    ev({
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "a", name: "edit", arguments: { path: "a.ts" } },
          { type: "toolCall", id: "b", name: "edit", arguments: { path: "b.ts" } },
        ],
      },
      assistantMessageEvent: { type: "toolcall_start", contentIndex: 0 },
    });
    ev({ type: "tool_execution_start", toolCallId: "a", toolName: "edit", args: { path: "a.ts" } });
    ev({ type: "tool_execution_start", toolCallId: "b", toolName: "edit", args: { path: "b.ts" } });

    const toolIds = state.messages
      .filter((m) => m.role === "tool")
      .map((m) => (m.role === "tool" ? m.id : ""));
    expect(toolIds).toContain("tool-a");
    expect(state.streamingMessage?.role === "tool" && state.streamingMessage.id).toBe("tool-b");

    // a finishes first: it lands in history while b stays live.
    ev({
      type: "tool_execution_end",
      toolCallId: "a",
      toolName: "edit",
      result: { ok: true },
      isError: false,
    });
    const a = state.messages.find((m) => m.role === "tool" && m.id === "tool-a");
    expect(a).toMatchObject({ role: "tool", streaming: false });
    expect(state.streamingMessage?.role === "tool" && state.streamingMessage.id).toBe("tool-b");

    // b finishes last: both cards are committed in order.
    ev({
      type: "tool_execution_end",
      toolCallId: "b",
      toolName: "edit",
      result: { ok: true },
      isError: false,
    });
    const ids = state.messages
      .filter((m) => m.role === "tool")
      .map((m) => (m.role === "tool" ? m.id : ""));
    expect(ids).toEqual(["tool-a", "tool-b"]);
    expect(state.streamingMessage).toBeNull();
  });

  it("applies tool_execution_update to the live tool card", () => {
    let state = createChatState();
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s1",
      event: {
        type: "tool_execution_start",
        toolCallId: "b1",
        toolName: "bash",
        args: { command: "echo hi" },
      },
    } as never);
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s1",
      event: {
        type: "tool_execution_update",
        toolCallId: "b1",
        toolName: "bash",
        args: { command: "echo hi" },
        partialResult: { content: [{ type: "text", text: "hi\n" }] },
      },
    } as never);
    expect(state.streamingMessage?.role).toBe("tool");
    if (state.streamingMessage?.role === "tool") {
      expect(state.streamingMessage.result).toEqual({
        content: [{ type: "text", text: "hi\n" }],
      });
      expect(state.streamingMessage.streaming).toBe(true);
    }
  });
});

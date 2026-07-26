import { describe, expect, it } from "vitest";
import {
  appendUserMessage,
  createChatState,
  reduceChatEvent,
} from "../../src/renderer/src/stores/chat-reducer";

describe("reduceChatEvent", () => {
  it("appends a user message", () => {
    let state = createChatState();
    state = appendUserMessage(state, "hello");
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ role: "user", text: "hello" });
  });

  it("upserts assistant stream text on message_update", () => {
    let state = createChatState();
    const sessionId = "sess-1";
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId,
      event: {
        type: "message_start",
        message: {
          role: "assistant",
          id: "asst-1",
          content: [{ type: "text", text: "" }],
        },
      },
    });
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId,
      event: {
        type: "message_update",
        message: {
          role: "assistant",
          id: "asst-1",
          content: [{ type: "text", text: "Hel" }],
        },
        assistantMessageEvent: { type: "text_delta", delta: "Hel" },
      },
    });
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId,
      event: {
        type: "message_update",
        message: {
          role: "assistant",
          id: "asst-1",
          content: [{ type: "text", text: "Hello" }],
        },
        assistantMessageEvent: { type: "text_delta", delta: "lo" },
      },
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      role: "assistant",
      id: "asst-1",
      text: "Hello",
      streaming: true,
    });
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId,
      event: {
        type: "message_end",
        message: {
          role: "assistant",
          id: "asst-1",
          content: [{ type: "text", text: "Hello" }],
        },
      },
    });
    expect(state.messages[0]).toMatchObject({ streaming: false });
  });

  it("upserts tool call rows", () => {
    let state = createChatState();
    const sessionId = "sess-1";
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId,
      event: {
        type: "tool_execution_start",
        toolCallId: "tc-1",
        toolName: "read",
        args: { path: "foo.txt" },
      },
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      role: "tool",
      toolCallId: "tc-1",
      toolName: "read",
      streaming: true,
    });
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId,
      event: {
        type: "tool_execution_end",
        toolCallId: "tc-1",
        toolName: "read",
        result: { ok: true },
        isError: false,
      },
    });
    expect(state.messages[0]).toMatchObject({
      streaming: false,
      result: { ok: true },
      isError: false,
    });
  });

  it("marks idle on prompt_done", () => {
    let state = createChatState();
    state = { ...state, running: true };
    state = reduceChatEvent(state, { type: "prompt_done", sessionId: "s" });
    expect(state.running).toBe(false);
  });

  it("records prompt_error", () => {
    let state = createChatState();
    state = { ...state, running: true };
    state = reduceChatEvent(state, {
      type: "prompt_error",
      sessionId: "s",
      errorMessage: "auth failed",
    });
    expect(state.running).toBe(false);
    expect(state.messages.at(-1)).toMatchObject({
      role: "error",
      text: "auth failed",
    });
  });
});

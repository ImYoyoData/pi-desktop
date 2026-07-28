import { describe, expect, it } from "vitest";
import { ASK_USER_TOOL_NAME } from "../../src/shared/ask-user";
import {
  appendUserMessage,
  clearPendingAskUser,
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

  it("appends user images for chat bubble display", () => {
    let state = createChatState();
    state = appendUserMessage(state, " ", [
      { mimeType: "image/png", dataUrl: "data:image/png;base64,abc" },
    ]);
    expect(state.messages[0]).toMatchObject({
      role: "user",
      text: "",
      images: [{ mimeType: "image/png", dataUrl: "data:image/png;base64,abc" }],
    });
  });

  it("keeps element tags on user message", () => {
    let state = createChatState();
    state = appendUserMessage(state, "这个是？", undefined, [
      { url: "https://www.baidu.com/", host: "www.baidu.com", label: "#s-hotsearch-wrapper" },
    ]);
    expect(state.messages[0]).toMatchObject({
      role: "user",
      text: "这个是？",
      elementTags: [{ host: "www.baidu.com", label: "#s-hotsearch-wrapper" }],
    });
  });

  it("does not duplicate user bubble when agent echoes citation dump", () => {
    let state = createChatState();
    state = appendUserMessage(state, "这个是？", undefined, [
      { url: "https://www.baidu.com/", host: "www.baidu.com", label: "#x" },
    ]);
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s",
      event: {
        type: "message_end",
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: "Context from browser selection:\n\n### Citation 1\n- URL: https://www.baidu.com/\n\n---\n\n这个是？",
            },
          ],
        },
      },
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ role: "user", text: "这个是？" });
  });

  it("does not mirror @path chip expansion as a second user bubble", () => {
    let state = createChatState();
    state = appendUserMessage(state, "删除", undefined, [
      {
        url: "txt",
        host: "",
        label: "txt",
        content: "txt",
        kind: "file",
      },
    ]);
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s",
      event: {
        type: "message_end",
        message: {
          role: "user",
          content: [{ type: "text", text: "删除\n\n@txt" }],
        },
      },
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      role: "user",
      text: "删除",
      elementTags: [{ kind: "file", content: "txt" }],
    });
  });

  it("keeps a single streaming bubble replaced on message_update (pi-web style)", () => {
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
    expect(state.messages).toHaveLength(0);
    expect(state.streamingMessage).toMatchObject({
      role: "assistant",
      id: "asst-1",
      streaming: true,
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
      },
    });
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId,
      event: {
        type: "message_update",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello" }],
        },
      },
    });
    expect(state.messages).toHaveLength(0);
    expect(state.streamingMessage).toMatchObject({
      role: "assistant",
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
    expect(state.streamingMessage).toBeNull();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      role: "assistant",
      text: "Hello",
      streaming: false,
    });
  });

  it("appends via text_delta when snapshot empty", () => {
    let state = createChatState();
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s",
      event: {
        type: "message_start",
        message: { role: "assistant", content: [{ type: "text", text: "" }] },
      },
    });
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s",
      event: {
        type: "message_update",
        message: { role: "assistant", content: [{ type: "text", text: "" }] },
        assistantMessageEvent: { type: "text_delta", delta: "你" },
      },
    });
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s",
      event: {
        type: "message_update",
        message: { role: "assistant", content: [{ type: "text", text: "" }] },
        assistantMessageEvent: { type: "text_delta", delta: "好" },
      },
    });
    expect(state.messages).toHaveLength(0);
    expect(state.streamingMessage).toMatchObject({ text: "你好" });
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
    expect(state.streamingMessage).toMatchObject({
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
    expect(state.streamingMessage).toBeNull();
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

  it("marks idle on agent_settled", () => {
    let state = createChatState();
    state = { ...state, running: true };
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s",
      event: { type: "agent_settled" },
    });
    expect(state.running).toBe(false);
  });

  it("keeps running on agent_end when willRetry", () => {
    let state = createChatState();
    state = { ...state, running: true };
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s",
      event: { type: "agent_end", willRetry: true },
    });
    expect(state.running).toBe(true);
  });

  it("keeps running on agent_end until prompt_done", () => {
    let state = createChatState();
    state = { ...state, running: true };
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s",
      event: { type: "agent_end", willRetry: false },
    });
    expect(state.running).toBe(true);
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

  it("surfaces assistant stopReason error as chat error", () => {
    let state = createChatState();
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s",
      event: {
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "Invalid API key",
        },
      },
    });
    expect(state.running).toBe(false);
    expect(state.messages.at(-1)).toMatchObject({
      role: "error",
    });
    expect(String((state.messages.at(-1) as { text: string }).text)).toMatch(/API Key|api key|Invalid/i);
  });

  it("surfaces auto_retry_end failure", () => {
    let state = createChatState();
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s",
      event: {
        type: "auto_retry_end",
        success: false,
        attempt: 3,
        finalError: "rate limited",
      },
    });
    expect(state.messages.at(-1)).toMatchObject({
      role: "error",
    });
    expect(String((state.messages.at(-1) as { text: string }).text).length).toBeGreaterThan(0);
  });

  it("stores retry hint on auto_retry_start", () => {
    let state = createChatState();
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s",
      event: {
        type: "auto_retry_start",
        attempt: 2,
        maxAttempts: 3,
        delayMs: 1000,
        errorMessage: "429 rate limit",
      },
    });
    expect(state.running).toBe(true);
    expect(state.retryHint).toMatchObject({ attempt: 2, maxAttempts: 3 });
  });

  it("streams thinking text via thinking_delta and keeps it on message_end", () => {
    let state = createChatState();
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s",
      event: {
        type: "message_update",
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: "Let me" }],
        },
        assistantMessageEvent: { type: "thinking_delta", delta: " check" },
      },
    });
    expect(state.streamingMessage).toMatchObject({
      role: "assistant",
      thinking: "Let me",
    });

    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s",
      event: {
        type: "message_update",
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: "Let me check the file" }],
        },
        assistantMessageEvent: {
          type: "thinking_delta",
          delta: " the file",
        },
      },
    });
    expect(state.streamingMessage).toMatchObject({
      role: "assistant",
      thinking: "Let me check the file",
    });

    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s",
      event: {
        type: "message_end",
        message: {
          role: "assistant",
          id: "a1",
          content: [
            { type: "thinking", thinking: "Let me check the file" },
            { type: "text", text: "Done." },
          ],
        },
      },
    });
    expect(state.streamingMessage).toBeNull();
    expect(state.messages.at(-1)).toMatchObject({
      role: "assistant",
      text: "Done.",
      thinking: "Let me check the file",
    });
  });

  it("sets pendingAskUser on ask_user tool_execution_start", () => {
    let state = createChatState();
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s1",
      event: {
        type: "tool_execution_start",
        toolCallId: "t1",
        toolName: ASK_USER_TOOL_NAME,
        args: {
          questions: [
            {
              id: "q1",
              prompt: "Pick",
              type: "single",
              options: [{ id: "a", label: "A" }],
            },
          ],
        },
      },
    });
    expect(state.pendingAskUser?.questions[0]?.id).toBe("q1");
  });

  it("clearPendingAskUser drops pending prompt without adding a message", () => {
    let state = createChatState();
    state = {
      ...state,
      pendingAskUser: {
        questions: [
          {
            id: "q1",
            prompt: "Pick",
            type: "single",
            options: [{ id: "a", label: "A" }],
          },
        ],
      },
    };
    state = clearPendingAskUser(state);
    expect(state.pendingAskUser).toBeNull();
    expect(state.messages).toHaveLength(0);
  });

  it("clears pendingAskUser when appending a user message", () => {
    let state = createChatState();
    state = {
      ...state,
      pendingAskUser: {
        questions: [
          {
            id: "q1",
            prompt: "Pick",
            type: "single",
            options: [{ id: "a", label: "A" }],
          },
        ],
      },
    };
    state = appendUserMessage(state, "hello");
    expect(state.pendingAskUser).toBeNull();
  });

  it("replaces pendingAskUser on a newer ask_user call", () => {
    let state = createChatState();
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s1",
      event: {
        type: "tool_execution_start",
        toolCallId: "t1",
        toolName: ASK_USER_TOOL_NAME,
        args: {
          questions: [
            {
              id: "old",
              prompt: "Old",
              type: "buttons",
              options: [{ id: "y", label: "Yes" }],
            },
          ],
        },
      },
    });
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s1",
      event: {
        type: "tool_execution_start",
        toolCallId: "t2",
        toolName: ASK_USER_TOOL_NAME,
        args: {
          questions: [
            {
              id: "new",
              prompt: "New",
              type: "buttons",
              options: [{ id: "n", label: "No" }],
            },
          ],
        },
      },
    });
    expect(state.pendingAskUser?.questions[0]?.id).toBe("new");
  });

  it("clears pendingAskUser when ask_user args fail to parse", () => {
    let state = createChatState();
    state = {
      ...state,
      pendingAskUser: {
        questions: [
          {
            id: "q1",
            prompt: "Pick",
            type: "single",
            options: [{ id: "a", label: "A" }],
          },
        ],
      },
    };
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s1",
      event: {
        type: "tool_execution_start",
        toolCallId: "t1",
        toolName: ASK_USER_TOOL_NAME,
        args: { questions: [] },
      },
    });
    expect(state.pendingAskUser).toBeNull();
  });

  it("keeps pendingAskUser on non-ask_user tool_execution_start", () => {
    let state = createChatState();
    state = {
      ...state,
      pendingAskUser: {
        questions: [
          {
            id: "q1",
            prompt: "Pick",
            type: "single",
            options: [{ id: "a", label: "A" }],
          },
        ],
      },
    };
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s1",
      event: {
        type: "tool_execution_start",
        toolCallId: "t1",
        toolName: "read",
        args: { path: "foo.txt" },
      },
    });
    expect(state.pendingAskUser?.questions[0]?.id).toBe("q1");
  });
});

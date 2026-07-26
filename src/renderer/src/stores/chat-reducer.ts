import type { AgentEvent } from "../../../shared/protocol";

export type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string; streaming?: boolean }
  | {
      id: string;
      role: "tool";
      toolCallId: string;
      toolName: string;
      args?: unknown;
      result?: unknown;
      isError?: boolean;
      streaming?: boolean;
    }
  | { id: string; role: "error"; text: string };

export type ChatState = {
  messages: ChatMessage[];
  running: boolean;
};

export function createChatState(): ChatState {
  return { messages: [], running: false };
}

let nextLocalId = 0;
function localId(prefix: string): string {
  nextLocalId += 1;
  return `${prefix}-${nextLocalId}`;
}

function textFromMessage(message: Record<string, unknown>): string {
  const content = message.content;
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((part): part is { type: string; text: string } => {
      return Boolean(part && typeof part === "object" && (part as { type?: string }).type === "text");
    })
    .map((part) => part.text)
    .join("");
}

function messageId(message: Record<string, unknown>, fallback: string): string {
  const id = message.id;
  return typeof id === "string" && id.length > 0 ? id : fallback;
}

function upsertMessage(state: ChatState, message: ChatMessage): ChatState {
  const idx = state.messages.findIndex((m) => m.id === message.id);
  if (idx >= 0) {
    const next = [...state.messages];
    next[idx] = { ...next[idx], ...message };
    return { ...state, messages: next };
  }
  return { ...state, messages: [...state.messages, message] };
}

function reduceAgentPayload(state: ChatState, payload: Record<string, unknown>): ChatState {
  const type = payload.type;
  if (type === "agent_start" || type === "turn_start") {
    return { ...state, running: true };
  }
  if (type === "message_start") {
    const message = payload.message;
    if (!message || typeof message !== "object") {
      return state;
    }
    const msg = message as Record<string, unknown>;
    const role = msg.role;
    if (role === "user") {
      const text = textFromMessage(msg);
      const id = messageId(msg, localId("user"));
      const last = state.messages.at(-1);
      if (last?.role === "user" && last.text === text) {
        const next = [...state.messages];
        next[next.length - 1] = { id, role: "user", text };
        return { ...state, messages: next };
      }
      if (state.messages.some((m) => m.id === id)) {
        return state;
      }
      return upsertMessage(state, { id, role: "user", text });
    }
    if (role === "assistant") {
      const id = messageId(msg, localId("assistant"));
      return upsertMessage(state, {
        id,
        role: "assistant",
        text: textFromMessage(msg),
        streaming: true,
      });
    }
    return state;
  }
  if (type === "message_update") {
    const message = payload.message;
    if (!message || typeof message !== "object") {
      return state;
    }
    const msg = message as Record<string, unknown>;
    if (msg.role !== "assistant") {
      return state;
    }
    const id = messageId(msg, localId("assistant"));
    return upsertMessage(state, {
      id,
      role: "assistant",
      text: textFromMessage(msg),
      streaming: true,
    });
  }
  if (type === "message_end") {
    const message = payload.message;
    if (!message || typeof message !== "object") {
      return state;
    }
    const msg = message as Record<string, unknown>;
    if (msg.role === "assistant") {
      const id = messageId(msg, localId("assistant"));
      return upsertMessage(state, {
        id,
        role: "assistant",
        text: textFromMessage(msg),
        streaming: false,
      });
    }
    return state;
  }
  if (type === "tool_execution_start") {
    const toolCallId = String(payload.toolCallId ?? localId("tool"));
    const id = `tool-${toolCallId}`;
    return upsertMessage(state, {
      id,
      role: "tool",
      toolCallId,
      toolName: String(payload.toolName ?? "tool"),
      args: payload.args,
      streaming: true,
    });
  }
  if (type === "tool_execution_end") {
    const toolCallId = String(payload.toolCallId ?? "");
    const id = `tool-${toolCallId}`;
    return upsertMessage(state, {
      id,
      role: "tool",
      toolCallId,
      toolName: String(payload.toolName ?? "tool"),
      result: payload.result,
      isError: Boolean(payload.isError),
      streaming: false,
    });
  }
  return state;
}

export function appendUserMessage(state: ChatState, text: string): ChatState {
  const trimmed = text.trim();
  if (!trimmed) {
    return state;
  }
  return {
    ...state,
    running: true,
    messages: [...state.messages, { id: localId("user"), role: "user", text: trimmed }],
  };
}

export function reduceChatEvent(state: ChatState, event: AgentEvent): ChatState {
  switch (event.type) {
    case "connected":
      return state;
    case "agent_event":
      return reduceAgentPayload({ ...state, running: true }, event.event);
    case "prompt_done":
      return {
        ...state,
        running: false,
        messages: state.messages.map((m) =>
          m.role === "assistant" || m.role === "tool" ? { ...m, streaming: false } : m,
        ),
      };
    case "prompt_error":
      return {
        ...state,
        running: false,
        messages: [
          ...state.messages,
          { id: localId("error"), role: "error", text: event.errorMessage },
        ],
      };
    case "worker_stuck":
    case "worker_exit":
      return { ...state, running: false };
    default: {
      const _never: never = event;
      void _never;
      return state;
    }
  }
}

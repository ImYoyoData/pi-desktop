import type { AgentEvent } from "../../../shared/protocol";
import type { AskUserPrompt } from "../../../shared/ask-user";
import type { PermissionAskPrompt } from "../../../shared/desktop-security";
import type { ExtensionUiPending } from "../../../shared/extension-ui";
import { formatLlmError } from "../utils/llm-error";
import { locale as uiLocalePref } from "../i18n";

function uiLocale(): "zh-CN" | "en" {
  return uiLocalePref === "zh-CN" ? "zh-CN" : "en";
}

export type ChatUserImage = {
  mimeType: string;
  dataUrl: string;
};

export type PendingPermission = PermissionAskPrompt;

export type ChatMessage =
  | {
      id: string;
      role: "user";
      text: string;
      images?: ChatUserImage[];
      /** Cursor-style tags (element / file path / url) shown in the bubble. */
      elementTags?: {
        url: string;
        host: string;
        label: string;
        content?: string;
        kind?: "file" | "url" | "element" | "agent" | "plan" | "ask" | "task";
      }[];
    }
  | { id: string; role: "assistant"; text: string; thinking?: string; streaming?: boolean }
  | {
      id: string;
      role: "tool";
      toolCallId: string;
      toolName: string;
      args?: unknown;
      result?: unknown;
      isError?: boolean;
      streaming?: boolean;
      /** 1-based order within the current agent run */
      order?: number;
    }
  | { id: string; role: "error"; text: string };

export type ChatRetryHint = {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  message: string;
};

/** Matches pi-web useAgentSession: history vs live stream kept separate */
export type ChatState = {
  messages: ChatMessage[];
  /** Live assistant/tool bubble replaced on every message_update (not appended) */
  streamingMessage: ChatMessage | null;
  running: boolean;
  /** Shown while Pi SDK auto-retry is in progress */
  retryHint: ChatRetryHint | null;
  /** Next tool order index for the active run (reset when agent settles). */
  nextToolOrder: number;
  /** Interactive ask_user strip; null when none / discarded. */
  pendingAskUser: AskUserPrompt | null;
  /** Interactive permission strip; null when none. */
  pendingPermission: PendingPermission | null;
  /** Pi extension UI dialog (select/confirm/input/editor). */
  pendingExtensionUi: ExtensionUiPending | null;
};

export function createChatState(): ChatState {
  return {
    messages: [],
    streamingMessage: null,
    running: false,
    retryHint: null,
    nextToolOrder: 1,
    pendingAskUser: null,
    pendingPermission: null,
    pendingExtensionUi: null,
  };
}

export function clearPendingAskUser(state: ChatState): ChatState {
  if (!state.pendingAskUser) return state;
  return { ...state, pendingAskUser: null };
}

export function setPendingAskUser(
  state: ChatState,
  pending: AskUserPrompt | null,
): ChatState {
  return { ...state, pendingAskUser: pending };
}

export function clearPendingPermission(state: ChatState): ChatState {
  if (!state.pendingPermission) return state;
  return { ...state, pendingPermission: null };
}

export function setPendingPermission(
  state: ChatState,
  pending: PendingPermission | null,
): ChatState {
  return { ...state, pendingPermission: pending };
}

export function clearPendingExtensionUi(state: ChatState): ChatState {
  if (!state.pendingExtensionUi) return state;
  return { ...state, pendingExtensionUi: null };
}

export function setPendingExtensionUi(
  state: ChatState,
  pending: ExtensionUiPending | null,
): ChatState {
  return { ...state, pendingExtensionUi: pending };
}

let nextLocalId = 0;
function localId(prefix: string): string {
  nextLocalId += 1;
  return `${prefix}-${nextLocalId}`;
}

function textFromMessage(message: Record<string, unknown>): string {
  if (typeof message.text === "string") {
    return message.text;
  }
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

function thinkingFromMessage(message: Record<string, unknown>): string {
  const content = message.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: string; thinking: string } => {
      return (
        Boolean(part) &&
        typeof part === "object" &&
        (part as { type?: string }).type === "thinking" &&
        typeof (part as { thinking?: unknown }).thinking === "string"
      );
    })
    .map((part) => part.thinking)
    .join("");
}

function imagesFromMessage(message: Record<string, unknown>): ChatUserImage[] | undefined {
  const content = message.content;
  if (!Array.isArray(content)) return undefined;
  const images: ChatUserImage[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    if (p.type !== "image") continue;
    const mimeType = typeof p.mimeType === "string" && p.mimeType ? p.mimeType : "image/png";
    if (typeof p.data === "string" && p.data) {
      images.push({ mimeType, dataUrl: `data:${mimeType};base64,${p.data}` });
      continue;
    }
    if (typeof p.url === "string" && p.url.startsWith("data:")) {
      images.push({ mimeType, dataUrl: p.url });
    }
  }
  return images.length ? images : undefined;
}

function assistantFromPartial(
  msg: Record<string, unknown>,
  prev: ChatMessage | null,
): ChatMessage {
  const id =
    typeof msg.id === "string" && msg.id.length > 0
      ? msg.id
      : prev?.role === "assistant"
        ? prev.id
        : localId("assistant");
  const snapshot = textFromMessage(msg);
  const thinkingSnap = thinkingFromMessage(msg);
  const prevText = prev?.role === "assistant" ? prev.text : "";
  const prevThinking = prev?.role === "assistant" ? (prev.thinking ?? "") : "";
  const thinking = thinkingSnap || prevThinking;
  return {
    id,
    role: "assistant",
    text: snapshot || prevText,
    ...(thinking ? { thinking } : {}),
    streaming: true,
  };
}

/** Pi SDK assistant failures use stopReason + errorMessage instead of throwing. */
function sdkErrorText(msg: Record<string, unknown>): string | null {
  const stop = msg.stopReason;
  const err =
    typeof msg.errorMessage === "string" && msg.errorMessage.trim()
      ? msg.errorMessage.trim()
      : "";
  const loc = uiLocale();
  if (stop === "error") {
    return formatLlmError(err || "Request failed", loc);
  }
  if (stop === "aborted") {
    return formatLlmError(err || "Aborted", loc);
  }
  if (err && !textFromMessage(msg)) {
    return formatLlmError(err, loc);
  }
  return null;
}

function friendlyError(text: string): string {
  return formatLlmError(text, uiLocale());
}

function appendError(state: ChatState, text: string): ChatState {
  const trimmed = friendlyError(text).trim();
  if (!trimmed) return { ...state, running: false, streamingMessage: null, retryHint: null };
  const last = state.messages.at(-1);
  if (last?.role === "error" && last.text === trimmed) {
    return { ...state, running: false, streamingMessage: null, retryHint: null };
  }
  return {
    ...state,
    running: false,
    streamingMessage: null,
    retryHint: null,
    messages: [...state.messages, { id: localId("error"), role: "error", text: trimmed }],
  };
}

function reduceAgentPayload(state: ChatState, payload: Record<string, unknown>): ChatState {
  const type = payload.type;
  if (type === "agent_start" || type === "turn_start") {
    return { ...state, running: true, streamingMessage: null, retryHint: null };
  }
  if (type === "auto_retry_start") {
    const attempt = typeof payload.attempt === "number" ? payload.attempt : 1;
    const maxAttempts = typeof payload.maxAttempts === "number" ? payload.maxAttempts : attempt;
    const delayMs = typeof payload.delayMs === "number" ? payload.delayMs : 0;
    const raw =
      typeof payload.errorMessage === "string" && payload.errorMessage.trim()
        ? payload.errorMessage.trim()
        : "";
    return {
      ...state,
      running: true,
      retryHint: {
        attempt,
        maxAttempts,
        delayMs,
        message: friendlyError(raw || "Request failed"),
      },
    };
  }
  if (type === "auto_retry_end") {
    if (payload.success === false) {
      const text =
        typeof payload.finalError === "string" && payload.finalError.trim()
          ? payload.finalError.trim()
          : "Request failed";
      return appendError(state, text);
    }
    return { ...state, retryHint: null };
  }
  if (type === "compaction_end" && typeof payload.errorMessage === "string" && payload.errorMessage) {
    return appendError(state, payload.errorMessage);
  }
  if (type === "message_start" || type === "message_update") {
    const message = payload.message;
    if (!message || typeof message !== "object") {
      return { ...state, running: true };
    }
    const msg = message as Record<string, unknown>;
    if (msg.role === "user") {
      return { ...state, running: true };
    }

    // Tool-shaped partials (rare on message_*) — ignore for stream bubble
    if (msg.role && msg.role !== "assistant") {
      return { ...state, running: true };
    }

    // Surface mid-stream API failures (empty content + errorMessage)
    const midError = sdkErrorText(msg);
    if (midError && msg.stopReason === "error") {
      return appendError(state, midError);
    }

    let nextStream = assistantFromPartial(msg, state.streamingMessage);

    const assistantEvent = payload.assistantMessageEvent;
    if (assistantEvent && typeof assistantEvent === "object") {
      const ev = assistantEvent as Record<string, unknown>;
      if (ev.type === "text_delta" && typeof ev.delta === "string") {
        const snapshot = textFromMessage(msg);
        if (!snapshot) {
          nextStream = {
            ...nextStream,
            text: nextStream.text + ev.delta,
          };
        }
      }
      if (ev.type === "thinking_delta" && typeof ev.delta === "string") {
        const snap = thinkingFromMessage(msg);
        if (!snap) {
          nextStream = {
            ...nextStream,
            thinking: (nextStream.thinking ?? "") + ev.delta,
          };
        }
      }
      if (ev.type === "thinking_end" && typeof ev.content === "string" && ev.content) {
        nextStream = {
          ...nextStream,
          thinking: ev.content,
        };
      }
      if (ev.type === "error" && typeof ev.error === "object" && ev.error) {
        const errObj = ev.error as Record<string, unknown>;
        const msgText =
          typeof errObj.message === "string"
            ? errObj.message
            : typeof ev.message === "string"
              ? ev.message
              : "Request failed";
        return appendError(state, msgText);
      }
    }

    return { ...state, running: true, streamingMessage: nextStream };
  }
  if (type === "message_end") {
    const message = payload.message;
    if (!message || typeof message !== "object") {
      return { ...state, streamingMessage: null };
    }
    const msg = message as Record<string, unknown>;
    if (msg.role === "user") {
      const text = textFromMessage(msg);
      const fromEvent = imagesFromMessage(msg);
      const id = typeof msg.id === "string" && msg.id ? msg.id : localId("user");
      const last = state.messages.at(-1);
      if (last?.role === "user") {
        const sameText = last.text === text || last.text.trim() === text.trim();
        const hasLocalExtras =
          Boolean(last.images?.length) || Boolean(last.elementTags?.length);
        // Agent expands browser selection into a long "Context from browser selection" prompt.
        // Keep the optimistic short user bubble; never show that dump as a second message.
        const expandedCitationEcho =
          /Context from browser selection:|### Citation\s+\d+/i.test(text) &&
          (!last.text.trim() ||
            text.trim().endsWith(last.text.trim()) ||
            text.includes(last.text.trim()));
        // File/URL chips are path/url *text* for the agent (`@path` / raw url). The bubble
        // keeps structured tags — never mirror the expanded prompt as another user row.
        if (sameText || expandedCitationEcho || hasLocalExtras) {
          const next = [...state.messages];
          next[next.length - 1] = {
            id,
            role: "user",
            text: last.text,
            images: last.images ?? fromEvent,
            elementTags: last.elementTags,
          };
          return { ...state, messages: next, streamingMessage: null };
        }
      }
      if (state.messages.some((m) => m.id === id)) {
        return { ...state, streamingMessage: null };
      }
      // Never surface agent-side citation dumps as user bubbles
      if (/Context from browser selection:|### Citation\s+\d+/i.test(text)) {
        return { ...state, streamingMessage: null };
      }
      return {
        ...state,
        messages: [
          ...state.messages,
          { id, role: "user", text, images: fromEvent },
        ],
        streamingMessage: null,
      };
    }
    if (msg.role === "assistant" || !msg.role) {
      const errText = sdkErrorText(msg);
      if (errText) {
        return appendError(state, errText);
      }
      const snapshot = textFromMessage(msg);
      const thinkingSnap = thinkingFromMessage(msg);
      const stream = state.streamingMessage;
      const id =
        typeof msg.id === "string" && msg.id
          ? msg.id
          : stream?.role === "assistant"
            ? stream.id
            : localId("assistant");
      const text =
        snapshot ||
        (stream?.role === "assistant" ? stream.text : "");
      const thinking =
        thinkingSnap ||
        (stream?.role === "assistant" ? stream.thinking : undefined) ||
        undefined;
      if (!text && !thinking) {
        return { ...state, streamingMessage: null };
      }
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id,
            role: "assistant",
            text,
            ...(thinking ? { thinking } : {}),
            streaming: false,
          },
        ],
        streamingMessage: null,
      };
    }
    return { ...state, streamingMessage: null };
  }
  if (type === "turn_end") {
    const message = payload.message;
    if (message && typeof message === "object") {
      const errText = sdkErrorText(message as Record<string, unknown>);
      if (errText) {
        return appendError(state, errText);
      }
    }
    return state;
  }
  if (type === "tool_execution_start") {
    const toolCallId = String(payload.toolCallId ?? localId("tool"));
    const id = `tool-${toolCallId}`;
    // Finalize any in-progress assistant text into history first
    let messages = state.messages;
    if (state.streamingMessage?.role === "assistant" && state.streamingMessage.text) {
      messages = [
        ...messages,
        { ...state.streamingMessage, streaming: false },
      ];
    }
    const order = state.nextToolOrder;
    const toolName = String(payload.toolName ?? "tool");
    return {
      ...state,
      running: true,
      messages,
      nextToolOrder: order + 1,
      streamingMessage: {
        id,
        role: "tool",
        toolCallId,
        toolName,
        args: payload.args,
        streaming: true,
        order,
      },
    };
  }
  if (type === "tool_execution_end") {
    const toolCallId = String(payload.toolCallId ?? "");
    const id = `tool-${toolCallId}`;
    const stream =
      state.streamingMessage?.role === "tool" && state.streamingMessage.id === id
        ? state.streamingMessage
        : null;
    const existing = state.messages.find((m) => m.id === id);
    const prior =
      stream ??
      (existing?.role === "tool" ? existing : null);
    const toolMsg: ChatMessage = {
      id,
      role: "tool",
      toolCallId,
      toolName: String(payload.toolName ?? prior?.toolName ?? "tool"),
      args: prior?.args ?? payload.args,
      result: payload.result,
      isError: Boolean(payload.isError),
      streaming: false,
      order: prior?.order,
    };
    // Replace streaming tool or append
    if (stream) {
      return {
        ...state,
        messages: [...state.messages, toolMsg],
        streamingMessage: null,
      };
    }
    const idx = state.messages.findIndex((m) => m.id === id);
    if (idx >= 0) {
      const next = [...state.messages];
      next[idx] = toolMsg;
      return { ...state, messages: next, streamingMessage: null };
    }
    return {
      ...state,
      messages: [...state.messages, toolMsg],
      streamingMessage: null,
    };
  }
  if (type === "agent_end") {
    if (payload.willRetry === true) {
      return state;
    }
    // Prefer explicit error from last assistant message if UI missed message_end
    const lastError =
      typeof payload.lastError === "string" && payload.lastError.trim()
        ? payload.lastError.trim()
        : null;
    if (lastError) {
      return appendError(state, lastError);
    }
    const messages = payload.messages;
    if (Array.isArray(messages) && messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last && typeof last === "object") {
        const errText = sdkErrorText(last as Record<string, unknown>);
        if (errText) {
          return appendError(state, errText);
        }
      }
    }
    // Keep running until prompt_done — agent_end can arrive before prompt() resolves.
    return { ...state, streamingMessage: null, retryHint: null, nextToolOrder: 1 };
  }
  if (type === "agent_settled") {
    // Fallback idle if prompt_done was missed; normally prompt_done clears running.
    return { ...state, running: false, streamingMessage: null, retryHint: null, nextToolOrder: 1 };
  }
  return state;
}

export function appendUserMessage(
  state: ChatState,
  text: string,
  images?: ChatUserImage[],
  elementTags?: {
    url: string;
    host: string;
    label: string;
    content?: string;
    kind?: "file" | "url" | "element" | "agent" | "plan" | "ask" | "task";
  }[],
): ChatState {
  const trimmed = text.trim();
  const hasImages = Boolean(images?.length);
  const hasTags = Boolean(elementTags?.length);
  if (!trimmed && !hasImages && !hasTags) {
    return state;
  }
  return {
    ...state,
    running: true,
    retryHint: null,
    nextToolOrder: 1,
    streamingMessage: null,
    pendingAskUser: null,
    messages: [
      ...state.messages,
      {
        id: localId("user"),
        role: "user",
        text: trimmed,
        images: hasImages ? images : undefined,
        elementTags: hasTags ? elementTags : undefined,
      },
    ],
  };
}

export function reduceChatEvent(state: ChatState, event: AgentEvent): ChatState {
  switch (event.type) {
    case "connected":
      return state;
    case "agent_event":
      // Don't force running:true here — late events after prompt_done would stick UI in "running"
      return reduceAgentPayload(state, event.event);
    case "prompt_done":
      return {
        ...state,
        running: false,
        retryHint: null,
        streamingMessage: null,
        messages: state.messages.map((m) =>
          m.role === "assistant" || m.role === "tool" ? { ...m, streaming: false } : m,
        ),
      };
    case "prompt_error":
      return appendError(state, event.errorMessage);
    case "worker_stuck":
      return { ...state, running: false, streamingMessage: null, retryHint: null };
    case "worker_exit":
      return { ...state, running: false, streamingMessage: null, retryHint: null };
    case "session_status":
      if (event.status === "running") {
        return { ...state, running: true };
      }
      // idle | error | stuck → not actively generating
      return { ...state, running: false, streamingMessage: null, retryHint: null };
    case "context_usage":
      return state;
    default: {
      const _never: never = event;
      void _never;
      return state;
    }
  }
}

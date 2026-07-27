import { defineStore } from "pinia";
import { computed, onScopeDispose, reactive } from "vue";
import type { AgentEvent, ElementCitation, PromptImageContent, SessionHistoryMessage } from "../../../shared/protocol";
import { toPromptCitations, toPromptImages } from "../../../shared/protocol";
import {
  appendUserMessage,
  createChatState,
  reduceChatEvent,
  type ChatMessage,
  type ChatState,
  type ChatUserImage,
} from "./chat-reducer";
import { useSessionsStore } from "./sessions";
import { formatLlmError } from "../utils/llm-error";

export type { ChatMessage, ChatState, ChatUserImage, ChatRetryHint } from "./chat-reducer";
export { appendUserMessage, createChatState, reduceChatEvent } from "./chat-reducer";

function toChatImages(images?: PromptImageContent[]): ChatUserImage[] | undefined {
  if (!images?.length) return undefined;
  const out: ChatUserImage[] = [];
  for (const img of images) {
    if (!img?.data) continue;
    const mimeType = img.mimeType || "image/png";
    out.push({ mimeType, dataUrl: `data:${mimeType};base64,${img.data}` });
  }
  return out.length ? out : undefined;
}

export const useChatStore = defineStore("chat", () => {
  const bySession = reactive<Record<string, ChatState>>({});
  const sessionsStore = useSessionsStore();

  function stateFor(sessionId: string): ChatState {
    if (!bySession[sessionId]) {
      bySession[sessionId] = createChatState();
    }
    return bySession[sessionId];
  }

  const activeMessages = computed(() => {
    const id = sessionsStore.activeId;
    if (!id) return [] as ChatMessage[];
    return stateFor(id).messages;
  });

  const activeStreaming = computed(() => {
    const id = sessionsStore.activeId;
    if (!id) return null as ChatMessage | null;
    return stateFor(id).streamingMessage;
  });

  const activeRunning = computed(() => {
    const id = sessionsStore.activeId;
    if (!id) return false;
    return stateFor(id).running;
  });

  const activeRetryHint = computed(() => {
    const id = sessionsStore.activeId;
    if (!id) return null;
    return stateFor(id).retryHint;
  });

  function applyEvent(event: AgentEvent): void {
    const sessionId = event.sessionId;
    bySession[sessionId] = reduceChatEvent(stateFor(sessionId), event);
  }

  function hydrateFromHistory(sessionId: string, history: SessionHistoryMessage[]): void {
    bySession[sessionId] = {
      messages: history.map((row) =>
        row.role === "user"
          ? { id: row.id, role: "user" as const, text: row.text }
          : { id: row.id, role: "assistant" as const, text: row.text },
      ),
      streamingMessage: null,
      running: false,
      retryHint: null,
    };
  }

  function clearSession(sessionId: string): void {
    delete bySession[sessionId];
  }

  let eventsBound = false;
  function bindEvents(): void {
    if (eventsBound) return;
    eventsBound = true;
    const off = window.api.sessions.onEvent((event) => {
      applyEvent(event);
    });
    onScopeDispose(() => {
      eventsBound = false;
      off();
    });
  }

  async function sendPrompt(
    sessionId: string,
    message: string,
    citations?: ElementCitation[],
    images?: PromptImageContent[],
    elementTags?: { url: string; host: string; label: string; content?: string }[],
  ): Promise<void> {
    const promptImages = toPromptImages(images);
    const promptCitations = toPromptCitations(citations);
    bySession[sessionId] = appendUserMessage(
      stateFor(sessionId),
      message,
      toChatImages(promptImages),
      elementTags?.length ? elementTags : undefined,
    );
    try {
      await sessionsStore.sendCommand(sessionId, {
        type: "prompt",
        message,
        citations: promptCitations,
        images: promptImages,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const text = formatLlmError(raw);
      const state = stateFor(sessionId);
      const last = state.messages.at(-1);
      if (!(last?.role === "error" && last.text === text)) {
        bySession[sessionId] = {
          ...state,
          running: false,
          streamingMessage: null,
          retryHint: null,
          messages: [
            ...state.messages,
            { id: `error-local-${Date.now()}`, role: "error", text },
          ],
        };
      } else {
        bySession[sessionId] = {
          ...state,
          running: false,
          streamingMessage: null,
          retryHint: null,
        };
      }
    }
  }

  async function steer(sessionId: string, message: string): Promise<void> {
    await sessionsStore.sendCommand(sessionId, { type: "steer", message });
  }

  async function followUp(sessionId: string, message: string): Promise<void> {
    await sessionsStore.sendCommand(sessionId, { type: "follow_up", message });
  }

  async function abort(sessionId: string): Promise<void> {
    await sessionsStore.sendCommand(sessionId, { type: "abort" });
  }

  async function truncateFrom(sessionId: string, messageId: string): Promise<void> {
    const state = stateFor(sessionId);
    const idx = state.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    bySession[sessionId] = {
      ...state,
      messages: state.messages.slice(0, idx),
      streamingMessage: null,
      running: false,
      retryHint: null,
    };
  }

  /** Re-edit a user message: keep messages before it, put text into composer via return value. */
  function beginEditUser(sessionId: string, messageId: string): string | null {
    const state = stateFor(sessionId);
    const idx = state.messages.findIndex((m) => m.id === messageId && m.role === "user");
    if (idx < 0) return null;
    const msg = state.messages[idx];
    if (msg.role !== "user") return null;
    bySession[sessionId] = {
      ...state,
      messages: state.messages.slice(0, idx),
      streamingMessage: null,
      running: false,
      retryHint: null,
    };
    return msg.text;
  }

  /** Regenerate from an assistant message by re-sending the preceding user prompt. */
  async function regenerate(sessionId: string, assistantMessageId: string): Promise<void> {
    const state = stateFor(sessionId);
    const idx = state.messages.findIndex((m) => m.id === assistantMessageId);
    if (idx < 0) return;
    let userIdx = -1;
    for (let i = idx - 1; i >= 0; i--) {
      if (state.messages[i].role === "user") {
        userIdx = i;
        break;
      }
    }
    if (userIdx < 0) return;
    const userMsg = state.messages[userIdx];
    if (userMsg.role !== "user") return;
    bySession[sessionId] = {
      ...state,
      messages: state.messages.slice(0, userIdx),
      streamingMessage: null,
      running: false,
      retryHint: null,
    };
    const images = userMsg.images?.map((img) => {
      const raw = img.dataUrl.replace(/^data:[^;]+;base64,/, "");
      return { type: "image" as const, data: raw, mimeType: img.mimeType };
    });
    await sendPrompt(
      sessionId,
      userMsg.text,
      undefined,
      images,
      userMsg.elementTags,
    );
  }

  /** Retry after an error bubble: re-send the last user turn before the error. */
  async function retryFromError(sessionId: string, errorMessageId: string): Promise<void> {
    const state = stateFor(sessionId);
    const errIdx = state.messages.findIndex((m) => m.id === errorMessageId && m.role === "error");
    if (errIdx < 0) return;
    let userIdx = -1;
    for (let i = errIdx - 1; i >= 0; i--) {
      if (state.messages[i].role === "user") {
        userIdx = i;
        break;
      }
    }
    if (userIdx < 0) return;
    const userMsg = state.messages[userIdx];
    if (userMsg.role !== "user") return;
    bySession[sessionId] = {
      ...state,
      messages: state.messages.slice(0, userIdx),
      streamingMessage: null,
      running: false,
      retryHint: null,
    };
    const images = userMsg.images?.map((img) => {
      const raw = img.dataUrl.replace(/^data:[^;]+;base64,/, "");
      return { type: "image" as const, data: raw, mimeType: img.mimeType };
    });
    await sendPrompt(
      sessionId,
      userMsg.text,
      undefined,
      images,
      userMsg.elementTags,
    );
  }

  return {
    bySession,
    activeMessages,
    activeStreaming,
    activeRunning,
    activeRetryHint,
    bindEvents,
    hydrateFromHistory,
    clearSession,
    sendPrompt,
    steer,
    followUp,
    abort,
    truncateFrom,
    beginEditUser,
    regenerate,
    retryFromError,
  };
});

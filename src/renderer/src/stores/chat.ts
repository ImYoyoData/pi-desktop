import { defineStore } from "pinia";
import { computed, onScopeDispose, reactive } from "vue";
import type { AgentEvent, ElementCitation, SessionHistoryMessage } from "../../../shared/protocol";
import {
  appendUserMessage,
  createChatState,
  reduceChatEvent,
  type ChatMessage,
  type ChatState,
} from "./chat-reducer";
import { useSessionsStore } from "./sessions";

export type { ChatMessage, ChatState } from "./chat-reducer";
export { appendUserMessage, createChatState, reduceChatEvent } from "./chat-reducer";

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
    images?: unknown[],
  ): Promise<void> {
    bySession[sessionId] = appendUserMessage(stateFor(sessionId), message);
    try {
      await sessionsStore.sendCommand(sessionId, {
        type: "prompt",
        message,
        citations,
        images,
      });
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      const state = stateFor(sessionId);
      const last = state.messages.at(-1);
      if (!(last?.role === "error" && last.text === text)) {
        bySession[sessionId] = {
          ...state,
          running: false,
          streamingMessage: null,
          messages: [
            ...state.messages,
            { id: `error-local-${Date.now()}`, role: "error", text },
          ],
        };
      } else {
        bySession[sessionId] = { ...state, running: false, streamingMessage: null };
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
    };
    await sendPrompt(sessionId, userMsg.text);
  }

  return {
    bySession,
    activeMessages,
    activeStreaming,
    activeRunning,
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
  };
});

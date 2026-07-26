import { defineStore } from "pinia";
import { computed, onScopeDispose, reactive } from "vue";
import type { AgentEvent, ElementCitation } from "../../../shared/protocol";
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
    if (!id) {
      return [] as ChatMessage[];
    }
    return stateFor(id).messages;
  });

  const activeRunning = computed(() => {
    const id = sessionsStore.activeId;
    if (!id) {
      return false;
    }
    return stateFor(id).running;
  });

  function applyEvent(event: AgentEvent): void {
    const sessionId = event.sessionId;
    bySession[sessionId] = reduceChatEvent(stateFor(sessionId), event);
  }

  function bindEvents(): void {
    const off = window.api.sessions.onEvent((event) => {
      applyEvent(event);
    });
    onScopeDispose(off);
  }

  async function sendPrompt(
    sessionId: string,
    message: string,
    citations?: ElementCitation[],
  ): Promise<void> {
    bySession[sessionId] = appendUserMessage(stateFor(sessionId), message);
    await sessionsStore.sendCommand(sessionId, {
      type: "prompt",
      message,
      citations,
    });
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

  return {
    bySession,
    activeMessages,
    activeRunning,
    bindEvents,
    sendPrompt,
    steer,
    followUp,
    abort,
  };
});

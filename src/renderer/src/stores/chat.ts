import { defineStore } from "pinia";
import { computed, onScopeDispose, reactive, ref } from "vue";
import type { AgentEvent, ElementCitation, PromptImageContent, SessionHistoryMessage } from "../../../shared/protocol";
import { toPromptCitations, toPromptImages } from "../../../shared/protocol";
import {
  appendUserMessage,
  clearPendingAskUser,
  createChatState,
  reduceChatEvent,
  type ChatMessage,
  type ChatState,
  type ChatUserImage,
} from "./chat-reducer";
import { useSessionsStore } from "./sessions";
import { useCheckpointStore } from "./checkpoint";
import { useNotifyStore } from "./notify";
import { formatLlmError } from "../utils/llm-error";
import { locale, t } from "../i18n";

export type { ChatMessage, ChatState, ChatUserImage, ChatRetryHint } from "./chat-reducer";
export {
  appendUserMessage,
  clearPendingAskUser,
  createChatState,
  reduceChatEvent,
} from "./chat-reducer";

/** In-progress re-edit of a published user bubble (messages stay until commit/send). */
export type PendingUserEdit = {
  sessionId: string;
  messageId: string;
};

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
  const checkpointStore = useCheckpointStore();
  const notifyStore = useNotifyStore();
  const pendingUserEdit = ref<PendingUserEdit | null>(null);
  const historyLoadingId = ref<string | null>(null);

  function stateFor(sessionId: string): ChatState {
    if (!bySession[sessionId]) {
      bySession[sessionId] = createChatState();
    }
    return bySession[sessionId];
  }

  const historyLoading = computed(() => {
    const id = sessionsStore.activeId;
    return Boolean(id && historyLoadingId.value === id);
  });

  function beginHistoryLoad(sessionId: string): void {
    historyLoadingId.value = sessionId;
  }

  function endHistoryLoad(sessionId: string): void {
    if (historyLoadingId.value === sessionId) {
      historyLoadingId.value = null;
    }
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

  const activePendingAskUser = computed(() => {
    const id = sessionsStore.activeId;
    if (!id) return null;
    return stateFor(id).pendingAskUser;
  });

  function clearPendingAskUserFor(sessionId: string): void {
    bySession[sessionId] = clearPendingAskUser(stateFor(sessionId));
  }

  function applyEvent(event: AgentEvent): void {
    const sessionId = event.sessionId;
    bySession[sessionId] = reduceChatEvent(stateFor(sessionId), event);
    if (event.type === "prompt_done" || event.type === "prompt_error") {
      void checkpointStore.finishActive(sessionId);
    }
    if (event.type === "prompt_done") {
      void notifyStore.onTurnComplete({
        title: "Pi Desktop",
        body: t.notifyTurnCompleteBody,
      });
    }
  }

  function hydrateFromHistory(sessionId: string, history: SessionHistoryMessage[]): void {
    pendingUserEdit.value = null;
    bySession[sessionId] = {
      messages: history.map((row) =>
        row.role === "user"
          ? { id: row.id, role: "user" as const, text: row.text }
          : {
              id: row.id,
              role: "assistant" as const,
              text: row.text,
              ...(row.thinking ? { thinking: row.thinking } : {}),
            },
      ),
      streamingMessage: null,
      running: false,
      retryHint: null,
      nextToolOrder: 1,
      pendingAskUser: null,
    };
  }

  function clearSession(sessionId: string): void {
    if (pendingUserEdit.value?.sessionId === sessionId) {
      pendingUserEdit.value = null;
    }
    delete bySession[sessionId];
  }

  let eventsBound = false;
  function bindEvents(): void {
    if (eventsBound) return;
    eventsBound = true;
    checkpointStore.bindEvents();
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
    elementTags?: {
      url: string;
      host: string;
      label: string;
      content?: string;
      kind?: "file" | "url" | "element" | "agent" | "plan" | "ask" | "task";
    }[],
    /** Bubble text (defaults to `message`). Agent always receives `message`. */
    displayText?: string,
  ): Promise<void> {
    const promptImages = toPromptImages(images);
    const promptCitations = toPromptCitations(citations);
    const bubbleText = displayText !== undefined ? displayText : message;
    bySession[sessionId] = appendUserMessage(
      stateFor(sessionId),
      bubbleText,
      toChatImages(promptImages),
      elementTags?.length ? elementTags : undefined,
    );
    const last = stateFor(sessionId).messages.at(-1);
    if (last?.role === "user") {
      // Must finish begin (baseline snapshot) before the agent starts writing files.
      await checkpointStore.begin(sessionId, last.id);
    }
    try {
      await sessionsStore.sendCommand(sessionId, {
        type: "prompt",
        message,
        citations: promptCitations,
        images: promptImages,
      });
    } catch (err) {
      void checkpointStore.finishActive(sessionId);
      const raw = err instanceof Error ? err.message : String(err);
      const text = formatLlmError(raw, locale === "zh-CN" ? "zh-CN" : "en");
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
    clearPendingAskUserFor(sessionId);
    await sessionsStore.sendCommand(sessionId, { type: "steer", message });
  }

  async function followUp(sessionId: string, message: string): Promise<void> {
    clearPendingAskUserFor(sessionId);
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

  /** Start re-edit: keep chat intact; truncate only on commit (send). */
  function beginEditUser(
    sessionId: string,
    messageId: string,
  ): Extract<ChatMessage, { role: "user" }> | null {
    const state = stateFor(sessionId);
    const idx = state.messages.findIndex((m) => m.id === messageId && m.role === "user");
    if (idx < 0) return null;
    const msg = state.messages[idx];
    if (msg.role !== "user") return null;
    pendingUserEdit.value = { sessionId, messageId };
    return msg;
  }

  function cancelEditUser(): void {
    pendingUserEdit.value = null;
  }

  /** Drop the edited user turn and everything after it. Call right before re-send. */
  function commitEditUser(sessionId: string): boolean {
    const pending = pendingUserEdit.value;
    if (!pending || pending.sessionId !== sessionId) return false;
    const state = stateFor(sessionId);
    const idx = state.messages.findIndex((m) => m.id === pending.messageId && m.role === "user");
    pendingUserEdit.value = null;
    if (idx < 0) return false;
    bySession[sessionId] = {
      ...state,
      messages: state.messages.slice(0, idx),
      streamingMessage: null,
      running: false,
      retryHint: null,
    };
    return true;
  }

  function isPendingEditMessage(sessionId: string, messageId: string): boolean {
    const p = pendingUserEdit.value;
    return Boolean(p && p.sessionId === sessionId && p.messageId === messageId);
  }

  /** True for the edited bubble and everything after it (dim while editing). */
  function isPendingEditTail(sessionId: string, messageId: string): boolean {
    const p = pendingUserEdit.value;
    if (!p || p.sessionId !== sessionId) return false;
    const state = stateFor(sessionId);
    const editIdx = state.messages.findIndex((m) => m.id === p.messageId);
    const msgIdx = state.messages.findIndex((m) => m.id === messageId);
    return editIdx >= 0 && msgIdx >= editIdx;
  }

  /** Regenerate from an assistant message by re-sending the preceding user prompt. */
  async function regenerate(sessionId: string, assistantMessageId: string): Promise<void> {
    pendingUserEdit.value = null;
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
    pendingUserEdit.value = null;
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
    pendingUserEdit,
    historyLoadingId,
    historyLoading,
    activeMessages,
    activeStreaming,
    activeRunning,
    activeRetryHint,
    activePendingAskUser,
    bindEvents,
    clearPendingAskUserFor,
    beginHistoryLoad,
    endHistoryLoad,
    hydrateFromHistory,
    clearSession,
    sendPrompt,
    steer,
    followUp,
    abort,
    truncateFrom,
    beginEditUser,
    cancelEditUser,
    commitEditUser,
    isPendingEditMessage,
    isPendingEditTail,
    regenerate,
    retryFromError,
  };
});

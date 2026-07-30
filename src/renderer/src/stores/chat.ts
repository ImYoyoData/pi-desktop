import { defineStore } from "pinia";
import { computed, onScopeDispose, reactive, ref } from "vue";
import { createDiscreteApi } from "naive-ui";
import type { AgentEvent, ElementCitation, PromptImageContent, SessionHistoryMessage, SessionHistoryPage } from "../../../shared/protocol";
import { toPromptCitations, toPromptImages } from "../../../shared/protocol";
import {
  appendUserMessage,
  clearPendingAskUser,
  clearPendingExtensionUi,
  clearPendingPermission,
  createChatState,
  reduceChatEvent,
  setPendingAskUser,
  setPendingExtensionUi,
  setPendingPermission,
  type ChatMessage,
  type ChatState,
  type ChatUserImage,
  type PendingPermission,
} from "./chat-reducer";
import { stripComposerModePreamble } from "../../../shared/composer-modes";
import { useSessionsStore } from "./sessions";
import { useCheckpointStore } from "./checkpoint";
import { useComposerStore } from "./composer";
import { useNotifyStore } from "./notify";
import { useTtsStore } from "./tts";
import { t } from "../i18n";
import {
  isPermissionAskCancelled,
  type PermissionDecision,
} from "../../../shared/desktop-security";
import {
  isAskUserAskCancelled,
  type AskUserAskReply,
  type AskUserPrompt,
} from "../../../shared/ask-user";
import {
  isExtensionUiCancelled,
  isExtensionUiPending,
  type ExtensionUiEvent,
  type ExtensionUiPending,
  type ExtensionUiReply,
} from "../../../shared/extension-ui";

const { message: discreteMessage } = createDiscreteApi(["message"]);

export type { ChatMessage, ChatState, ChatUserImage, ChatRetryHint, PendingPermission } from "./chat-reducer";
export {
  appendUserMessage,
  clearPendingAskUser,
  clearPendingExtensionUi,
  clearPendingPermission,
  createChatState,
  reduceChatEvent,
  setPendingAskUser,
  setPendingExtensionUi,
  setPendingPermission,
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
  /** Session file path used for older-history pages. */
  const historyFileBySession = reactive<Record<string, string | null>>({});
  const historyHasMoreBySession = reactive<Record<string, boolean>>({});
  const historyLoadingOlderId = ref<string | null>(null);
  /** Bumped when a permission ask is denied or times out — UI may toast Security remediation. */
  const securityRemediationTick = ref(0);

  function noteSecurityRemediation(): void {
    securityRemediationTick.value += 1;
  }

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

  const historyHasMore = computed(() => {
    const id = sessionsStore.activeId;
    if (!id) return false;
    return Boolean(historyHasMoreBySession[id]);
  });

  const historyLoadingOlder = computed(() => {
    const id = sessionsStore.activeId;
    return Boolean(id && historyLoadingOlderId.value === id);
  });

  function beginHistoryLoad(sessionId: string): void {
    historyLoadingId.value = sessionId;
  }

  function endHistoryLoad(sessionId: string): void {
    if (historyLoadingId.value === sessionId) {
      historyLoadingId.value = null;
    }
  }

  function mapHistoryRow(row: SessionHistoryMessage): ChatMessage {
    if (row.role === "user") {
      return {
        id: row.id,
        role: "user" as const,
        text: stripComposerModePreamble(row.text),
      };
    }
    if (row.role === "tool") {
      return {
        id: row.id,
        role: "tool" as const,
        toolCallId: row.toolCallId,
        toolName: row.toolName,
        args: row.args,
        result: row.text,
        isError: row.isError,
        streaming: false,
      };
    }
    return {
      id: row.id,
      role: "assistant" as const,
      text: row.text,
      ...(row.thinking ? { thinking: row.thinking } : {}),
    };
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

  const activePendingPermission = computed(() => {
    const id = sessionsStore.activeId;
    if (!id) return null;
    return stateFor(id).pendingPermission;
  });

  const activePendingExtensionUi = computed(() => {
    const id = sessionsStore.activeId;
    if (!id) return null;
    return stateFor(id).pendingExtensionUi;
  });

  function clearPendingAskUserFor(sessionId: string): void {
    bySession[sessionId] = clearPendingAskUser(stateFor(sessionId));
  }

  function setPendingAskUserFor(prompt: AskUserPrompt): void {
    if (!prompt.sessionId) return;
    bySession[prompt.sessionId] = setPendingAskUser(stateFor(prompt.sessionId), prompt);
  }

  function setPendingPermissionFor(req: PendingPermission): void {
    bySession[req.sessionId] = setPendingPermission(stateFor(req.sessionId), req);
  }

  function clearPendingPermissionFor(sessionId: string): void {
    bySession[sessionId] = clearPendingPermission(stateFor(sessionId));
  }

  function setPendingExtensionUiFor(req: ExtensionUiPending): void {
    bySession[req.sessionId] = setPendingExtensionUi(stateFor(req.sessionId), req);
  }

  function clearPendingExtensionUiFor(sessionId: string): void {
    bySession[sessionId] = clearPendingExtensionUi(stateFor(sessionId));
  }

  async function replyPermission(
    sessionId: string,
    requestId: string,
    decision: PermissionDecision,
  ): Promise<void> {
    clearPendingPermissionFor(sessionId);
    if (decision === "deny") {
      noteSecurityRemediation();
    }
    await window.api.sessions.permissionReply({ requestId, decision });
  }

  async function replyAskUser(payload: AskUserAskReply): Promise<void> {
    const id = sessionsStore.activeId;
    if (id) clearPendingAskUserFor(id);
    await window.api.sessions.askUserReply(payload);
  }

  async function replyExtensionUi(reply: ExtensionUiReply): Promise<void> {
    const id = sessionsStore.activeId;
    if (id) clearPendingExtensionUiFor(id);
    await window.api.sessions.extensionUiReply(reply);
  }

  function handleExtensionUiEvent(event: ExtensionUiEvent): void {
    if (isExtensionUiCancelled(event)) {
      const pending = stateFor(event.sessionId).pendingExtensionUi;
      if (pending?.requestId === event.requestId) {
        clearPendingExtensionUiFor(event.sessionId);
      }
      return;
    }
    if (isExtensionUiPending(event)) {
      setPendingExtensionUiFor(event);
      if (notifyStore.soundEnabled) {
        void notifyStore.playChime();
      }
      return;
    }
    if (event.method === "notify") {
      // Toast for the active session only to avoid noise from background workers.
      if (event.sessionId !== sessionsStore.activeId) return;
      if (event.notifyType === "error") discreteMessage.error(event.message);
      else if (event.notifyType === "warning") discreteMessage.warning(event.message);
      else discreteMessage.info(event.message);
      return;
    }
    if (event.method === "setEditorText") {
      if (event.sessionId !== sessionsStore.activeId) return;
      useComposerStore().draft = event.text;
      return;
    }
    // setStatus / setWidget / setTitle: reserved for a future chrome strip.
  }

  function applyEvent(event: AgentEvent): void {
    const sessionId = event.sessionId;
    bySession[sessionId] = reduceChatEvent(stateFor(sessionId), event);
    if (event.type === "prompt_done" || event.type === "prompt_error") {
      void checkpointStore.finishActive(sessionId);
    }
    if (event.type === "prompt_done") {
      void notifyStore.onTurnComplete({
        title: t.appName,
        body: t.notifyTurnCompleteBody,
      });
      // Only speak for the focused session — avoid background tabs narrating.
      if (sessionId === useSessionsStore().activeId) {
        const state = stateFor(sessionId);
        const lastAssistant = [...state.messages]
          .reverse()
          .find((m) => m.role === "assistant" && m.text?.trim());
        if (lastAssistant && "text" in lastAssistant && lastAssistant.text) {
          useTtsStore().speakReply(lastAssistant.text, lastAssistant.id);
        }
      }
    }
  }

  function hydrateFromHistory(sessionId: string, history: SessionHistoryMessage[]): void {
    pendingUserEdit.value = null;
    bySession[sessionId] = {
      messages: history.map(mapHistoryRow),
      streamingMessage: null,
      running: false,
      retryHint: null,
      nextToolOrder: 1,
      pendingAskUser: null,
      pendingPermission: null,
      pendingExtensionUi: null,
    };
    historyFileBySession[sessionId] = historyFileBySession[sessionId] ?? null;
    if (!history.length) {
      historyHasMoreBySession[sessionId] = false;
    }
  }

  function hydrateFromHistoryPage(
    sessionId: string,
    page: SessionHistoryPage,
    filePath: string | null,
  ): void {
    historyFileBySession[sessionId] = filePath;
    historyHasMoreBySession[sessionId] = page.hasMore;
    hydrateFromHistory(sessionId, page.messages);
  }

  /** Prepend older page when user scrolls up. Returns how many messages were added. */
  function prependHistory(sessionId: string, older: SessionHistoryMessage[]): number {
    if (!older.length) return 0;
    const state = stateFor(sessionId);
    const existing = new Set(state.messages.map((m) => m.id));
    const mapped = older.map(mapHistoryRow).filter((m) => !existing.has(m.id));
    if (!mapped.length) return 0;
    bySession[sessionId] = {
      ...state,
      messages: [...mapped, ...state.messages],
    };
    return mapped.length;
  }

  async function loadOlderHistory(sessionId: string): Promise<number> {
    if (historyLoadingOlderId.value === sessionId) return 0;
    if (!historyHasMoreBySession[sessionId]) return 0;
    const filePath = historyFileBySession[sessionId];
    if (!filePath) return 0;
    const oldest = stateFor(sessionId).messages[0]?.id;
    if (!oldest) return 0;
    historyLoadingOlderId.value = sessionId;
    try {
      const page = await window.api.sessions.history(filePath, {
        limit: 30,
        beforeId: oldest,
      });
      const added = prependHistory(sessionId, page.messages);
      historyHasMoreBySession[sessionId] = page.hasMore;
      return added;
    } catch (err) {
      console.error("load older history failed", err);
      return 0;
    } finally {
      if (historyLoadingOlderId.value === sessionId) {
        historyLoadingOlderId.value = null;
      }
    }
  }

  function clearSession(sessionId: string): void {
    delete bySession[sessionId];
    delete historyFileBySession[sessionId];
    delete historyHasMoreBySession[sessionId];
    if (pendingUserEdit.value?.sessionId === sessionId) {
      pendingUserEdit.value = null;
    }
  }

  let eventsBound = false;
  function bindEvents(): void {
    if (eventsBound) return;
    eventsBound = true;
    checkpointStore.bindEvents();
    const off = window.api.sessions.onEvent((event) => {
      applyEvent(event);
    });
    const offPermission = window.api.sessions.onPermission((req) => {
      if (isPermissionAskCancelled(req)) {
        const pending = stateFor(req.sessionId).pendingPermission;
        if (pending?.requestId === req.requestId) {
          clearPendingPermissionFor(req.sessionId);
          noteSecurityRemediation();
        }
        return;
      }
      setPendingPermissionFor(req);
      if (notifyStore.soundEnabled) {
        void notifyStore.playChime();
      }
    });
    const offAskUser = window.api.sessions.onAskUser((req) => {
      if (isAskUserAskCancelled(req)) {
        const pending = stateFor(req.sessionId).pendingAskUser;
        if (pending?.requestId === req.requestId) {
          clearPendingAskUserFor(req.sessionId);
        }
        return;
      }
      setPendingAskUserFor({
        sessionId: req.sessionId,
        requestId: req.requestId,
        questions: req.questions,
      });
      if (notifyStore.soundEnabled) {
        void notifyStore.playChime();
      }
    });
    const offExtensionUi = window.api.sessions.onExtensionUi((event) => {
      handleExtensionUiEvent(event);
    });
    onScopeDispose(() => {
      eventsBound = false;
      off();
      offPermission();
      offAskUser();
      offExtensionUi();
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
      const state = stateFor(sessionId);
      bySession[sessionId] = reduceChatEvent(state, {
        type: "prompt_error",
        sessionId,
        errorMessage: raw,
      });
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
    historyHasMore,
    historyLoadingOlder,
    activeMessages,
    activeStreaming,
    activeRunning,
    activeRetryHint,
    activePendingAskUser,
    activePendingPermission,
    activePendingExtensionUi,
    securityRemediationTick,
    bindEvents,
    clearPendingAskUserFor,
    replyPermission,
    replyAskUser,
    replyExtensionUi,
    beginHistoryLoad,
    endHistoryLoad,
    hydrateFromHistory,
    hydrateFromHistoryPage,
    loadOlderHistory,
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

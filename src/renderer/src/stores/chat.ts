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
  withRunClock,
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
import { useSessionWidgetsStore } from "./session-widgets";
import { extractToolResult } from "../utils/tool-diff";
import { isTodoToolName } from "../utils/session-todos";
import {
  agentOutputSilenceMs,
  agentWorkerSilenceMs,
  syncPhaseClock,
} from "../utils/agent-wait";
import {
  canAutoRecoverForReason,
  nextAutoRecoverCount,
  shouldSoftHangRecover,
  shouldStallRecover,
  type AutoRecoverReason,
} from "../utils/agent-auto-recover";
import {
  dropErrorKeepHistory,
  findUserBeforeError,
  turnHasProgressBeforeError,
} from "../utils/chat-retry-continue";
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
  /** Sessions currently inside autoRecover (restart + resend). */
  const recoveringIds = new Set<string>();
  /** Soft-hang timeout already reported for this turn (avoid repeat errors). */
  const softHangReported = new Set<string>();
  /** Event-loop stall already reported for this episode (watchdog runs every 5s). */
  const stallReported = new Set<string>();
  let softHangTimer: ReturnType<typeof setInterval> | null = null;

  function noteSecurityRemediation(): void {
    securityRemediationTick.value += 1;
  }

  function stateFor(sessionId: string): ChatState {
    if (!bySession[sessionId]) {
      bySession[sessionId] = createChatState();
    }
    return bySession[sessionId];
  }

  /** Commit chat state and reset phaseStartedAt when the wait phase changes. */
  function setSessionState(sessionId: string, next: ChatState): void {
    const prev = bySession[sessionId] ?? createChatState();
    bySession[sessionId] = syncPhaseClock(prev, next);
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

  /** Fields for the long-running wait indicator (phase / silence / worker alive). */
  const activeWaitState = computed(() => {
    const id = sessionsStore.activeId;
    if (!id) return null;
    const s = stateFor(id);
    if (!s.running && !s.autoRecovering) return null;
    return {
      running: s.running,
      streamingMessage: s.streamingMessage,
      retryHint: s.retryHint,
      pendingAskUser: s.pendingAskUser,
      pendingPermission: s.pendingPermission,
      pendingExtensionUi: s.pendingExtensionUi,
      turnStartedAt: s.turnStartedAt,
      phaseStartedAt: s.phaseStartedAt,
      lastActivityAt: s.lastActivityAt,
      lastWorkerAliveAt: s.lastWorkerAliveAt,
      autoRecovering: s.autoRecovering,
    };
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
    setSessionState(sessionId, clearPendingAskUser(stateFor(sessionId)));
  }

  function setPendingAskUserFor(prompt: AskUserPrompt): void {
    if (!prompt.sessionId) return;
    setSessionState(prompt.sessionId, setPendingAskUser(stateFor(prompt.sessionId), prompt));
  }

  function setPendingPermissionFor(req: PendingPermission): void {
    setSessionState(req.sessionId, setPendingPermission(stateFor(req.sessionId), req));
  }

  function clearPendingPermissionFor(sessionId: string): void {
    setSessionState(sessionId, clearPendingPermission(stateFor(sessionId)));
  }

  function setPendingExtensionUiFor(req: ExtensionUiPending): void {
    setSessionState(req.sessionId, setPendingExtensionUi(stateFor(req.sessionId), req));
  }

  function clearPendingExtensionUiFor(sessionId: string): void {
    setSessionState(sessionId, clearPendingExtensionUi(stateFor(sessionId)));
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
      // Todo / plan snapshots belong in the persistent panel — don't also toast.
      if (
        /(?:待办|计划进度|Todos\s+\d|☑|☐)/.test(event.message) &&
        event.message.includes("\n")
      ) {
        return;
      }
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
    if (event.method === "setWidget") {
      useSessionWidgetsStore().setWidget(
        event.sessionId,
        event.widgetKey,
        event.widgetLines,
      );
      return;
    }
    // setStatus / setTitle: reserved for future chrome.
  }

  function applyEvent(event: AgentEvent): void {
    const sessionId = event.sessionId;
    setSessionState(sessionId, reduceChatEvent(stateFor(sessionId), event));

    if (event.type === "agent_event") {
      const payload = event.event as {
        type?: unknown;
        toolName?: unknown;
        args?: unknown;
        result?: unknown;
        partialResult?: unknown;
        isError?: unknown;
      };
      if (payload.type === "agent_start" || payload.type === "turn_start") {
        softHangReported.delete(sessionId);
        stallReported.delete(sessionId);
      }
      if (
        typeof payload.toolName === "string" &&
        isTodoToolName(payload.toolName) &&
        !payload.isError
      ) {
        const widgets = useSessionWidgetsStore();
        if (
          payload.type === "tool_execution_start" ||
          payload.type === "tool_execution_update"
        ) {
          widgets.applyTodoToolArgs(sessionId, payload.args);
          if (payload.type === "tool_execution_update") {
            const { details } = extractToolResult(payload.partialResult);
            if (details) widgets.applyTodoToolResult(sessionId, details);
          }
        } else if (payload.type === "tool_execution_end") {
          widgets.applyTodoToolArgs(sessionId, payload.args);
          const { details } = extractToolResult(payload.result);
          // Prefer details; fall back to the whole result when details is missing.
          widgets.applyTodoToolResult(sessionId, details ?? payload.result);
        }
      }
      // Recover banner must clear when the agent loop finishes (prompt IPC may still lag).
      if (payload.type === "agent_end" || payload.type === "agent_settled") {
        clearAutoRecovering(sessionId);
        softHangReported.delete(sessionId);
        stallReported.delete(sessionId);
      }
    }

    if (event.type === "prompt_done" || event.type === "prompt_error") {
      void checkpointStore.finishActive(sessionId);
      softHangReported.delete(sessionId);
      stallReported.delete(sessionId);
      if (event.type === "prompt_done") {
        resetAutoRecoverBudget(sessionId);
      } else {
        clearAutoRecovering(sessionId);
      }
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

    if (event.type === "worker_stuck") {
      void autoRecover(sessionId, "worker_stuck");
    }

    if (event.type === "worker_stall") {
      if (!stallReported.has(sessionId)) {
        stallReported.add(sessionId);
        void autoRecover(sessionId, "stall");
      }
    }
  }

  /** Drop the "正在自动恢复" banner without resetting the attempt budget. */
  function clearAutoRecovering(sessionId: string): void {
    const cur = stateFor(sessionId);
    if (!cur.autoRecovering) return;
    setSessionState(sessionId, { ...cur, autoRecovering: false });
  }

  function resetAutoRecoverBudget(sessionId: string): void {
    const cur = stateFor(sessionId);
    if (!cur.autoRecovering && cur.autoRecoverCount === 0) return;
    setSessionState(sessionId, {
      ...cur,
      autoRecovering: false,
      autoRecoverCount: 0,
    });
  }

  /**
   * Restart the session worker (when needed) and re-send the last user prompt.
   * Shared by worker_stuck and soft-hang watchdogs.
   */
  async function autoRecover(
    sessionId: string,
    reason: AutoRecoverReason,
  ): Promise<boolean> {
    if (recoveringIds.has(sessionId)) return false;
    const state = stateFor(sessionId);
    if (state.pendingAskUser || state.pendingPermission || state.pendingExtensionUi) {
      return false;
    }
    if (!canAutoRecoverForReason(state.autoRecoverCount, reason)) {
      if (reason === "soft_hang") {
        setSessionState(sessionId, reduceChatEvent(state, {
          type: "prompt_error",
          sessionId,
          errorMessage: t.autoRecoverGaveUp,
        }));
      } else {
        discreteMessage.warning(t.autoRecoverGaveUp);
      }
      return false;
    }

    recoveringIds.add(sessionId);
    setSessionState(sessionId, {
      ...state,
      autoRecoverCount: nextAutoRecoverCount(state.autoRecoverCount),
      autoRecovering: true,
    });

    try {
      if (reason === "soft_hang") {
        try {
          await abort(sessionId);
        } catch {
          // Force-kill path may already have cleared the worker.
        }
      }

      try {
        await sessionsStore.restartWorker(sessionId, null);
      } catch (err) {
        discreteMessage.error(err instanceof Error ? err.message : String(err));
        return false;
      }

      const after = stateFor(sessionId);
      let userIdx = -1;
      for (let i = after.messages.length - 1; i >= 0; i--) {
        if (after.messages[i]!.role === "user") {
          userIdx = i;
          break;
        }
      }
      if (userIdx < 0) {
        return false;
      }
      const userMsg = after.messages[userIdx]!;
      if (userMsg.role !== "user") return false;

      setSessionState(sessionId, withRunClock({
        ...after,
        messages: after.messages.slice(0, userIdx),
        streamingMessage: null,
        running: false,
        retryHint: null,
        // Banner only covers restart+resend kickoff — not the whole retried turn.
        autoRecovering: false,
      }));

      discreteMessage.info(
        reason === "worker_stuck"
          ? t.autoRecoverWorkerStuck
          : reason === "stall"
            ? t.autoRecoverStall
            : t.autoRecoverSoftHang,
      );

      const images = userMsg.images?.map((img) => {
        const raw = img.dataUrl.replace(/^data:[^;]+;base64,/, "");
        return { type: "image" as const, data: raw, mimeType: img.mimeType };
      });
      // Release the recover lock before awaiting the turn so soft-hang can arm again
      // only after this prompt finishes (running becomes true via sendPrompt).
      recoveringIds.delete(sessionId);
      await sendPrompt(
        sessionId,
        userMsg.text,
        undefined,
        images,
        userMsg.elementTags,
      );
      return true;
    } finally {
      recoveringIds.delete(sessionId);
      clearAutoRecovering(sessionId);
    }
  }

  function checkSoftHangSessions(): void {
    const now = Date.now();
    for (const [sessionId, state] of Object.entries(bySession)) {
      if (!state?.running || state.autoRecovering || recoveringIds.has(sessionId)) continue;
      if (softHangReported.has(sessionId)) continue;
      const waitingUser = Boolean(
        state.pendingAskUser || state.pendingPermission || state.pendingExtensionUi,
      );
      const outputSilenceMs = agentOutputSilenceMs(state, now);
      const workerSilenceMs = agentWorkerSilenceMs(state, now);
      // Event-loop stall (heartbeats AND output dead) — full restart + resend.
      // Mirrors the main-process worker_stall event as a renderer-side fallback
      // (covers cases where the main timer was delayed). Deduped by recoveringIds
      // and stallReported (watchdog fires every 5s).
      if (shouldStallRecover({ running: state.running, waitingUser, outputSilenceMs, workerSilenceMs })) {
        if (!stallReported.has(sessionId)) {
          stallReported.add(sessionId);
          void autoRecover(sessionId, "stall");
        }
        continue;
      }
      const toolInFlight =
        state.streamingMessage?.role === "tool" ||
        state.messages.some((m) => m.role === "tool" && m.streaming);
      if (
        !shouldSoftHangRecover({
          running: state.running,
          waitingUser,
          toolInFlight,
          outputSilenceMs,
          workerSilenceMs,
        })
      ) {
        continue;
      }
      void reportModelTimeout(sessionId);
    }
  }

  /**
   * Worker is alive but the model/network produced no output for too long.
   * Surface a clear timeout error (with Retry) instead of killing as "worker stuck".
   */
  async function reportModelTimeout(sessionId: string): Promise<void> {
    if (softHangReported.has(sessionId) || recoveringIds.has(sessionId)) return;
    softHangReported.add(sessionId);
    try {
      try {
        await abort(sessionId);
      } catch {
        // Ignore — we still want the timeout bubble even if abort races.
      }
      setSessionState(sessionId, reduceChatEvent(stateFor(sessionId), {
        type: "prompt_error",
        sessionId,
        errorMessage: t.modelResponseTimeout,
      }));
      clearAutoRecovering(sessionId);
    } catch (err) {
      softHangReported.delete(sessionId);
      discreteMessage.error(err instanceof Error ? err.message : String(err));
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
      turnStartedAt: null,
      phaseStartedAt: null,
      lastActivityAt: null,
      lastWorkerAliveAt: null,
      autoRecoverCount: 0,
      autoRecovering: false,
    };
    softHangReported.delete(sessionId);
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
    setSessionState(sessionId, {
      ...state,
      messages: [...mapped, ...state.messages],
    });
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
    if (!softHangTimer) {
      softHangTimer = setInterval(() => checkSoftHangSessions(), 5_000);
    }
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
      if (softHangTimer) {
        clearInterval(softHangTimer);
        softHangTimer = null;
      }
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
    // A new task starts a clean slate: drop the previous round's todos so
    // fresh items never accumulate on top of the old list.
    useSessionWidgetsStore().resetTodosForSession(sessionId);
    setSessionState(sessionId, appendUserMessage(
      stateFor(sessionId),
      bubbleText,
      toChatImages(promptImages),
      elementTags?.length ? elementTags : undefined,
    ));
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
      setSessionState(sessionId, reduceChatEvent(state, {
        type: "prompt_error",
        sessionId,
        errorMessage: raw,
      }));
    }
  }

  async function steer(
    sessionId: string,
    message: string,
    images?: PromptImageContent[],
  ): Promise<void> {
    clearPendingAskUserFor(sessionId);
    await sessionsStore.sendCommand(sessionId, {
      type: "steer",
      message,
      ...(images?.length ? { images } : {}),
    });
  }

  async function followUp(sessionId: string, message: string): Promise<void> {
    clearPendingAskUserFor(sessionId);
    await sessionsStore.sendCommand(sessionId, { type: "follow_up", message });
  }

  async function abort(sessionId: string): Promise<void> {
    const row = sessionsStore.sessions.find((s) => s.id === sessionId);
    if (row?.status === "stuck") {
      await sessionsStore.killWorker(sessionId, null);
      const state = stateFor(sessionId);
      setSessionState(sessionId, withRunClock({
        ...state,
        running: false,
        streamingMessage: null,
        retryHint: null,
      }));
      return;
    }
    await sessionsStore.sendCommand(sessionId, { type: "abort" });
  }

  async function truncateFrom(sessionId: string, messageId: string): Promise<void> {
    const state = stateFor(sessionId);
    const idx = state.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    setSessionState(sessionId, withRunClock({
      ...state,
      messages: state.messages.slice(0, idx),
      streamingMessage: null,
      running: false,
      retryHint: null,
    }));
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
    setSessionState(sessionId, withRunClock({
      ...state,
      messages: state.messages.slice(0, idx),
      streamingMessage: null,
      running: false,
      retryHint: null,
    }));
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
    setSessionState(sessionId, withRunClock({
      ...state,
      messages: state.messages.slice(0, userIdx),
      streamingMessage: null,
      running: false,
      retryHint: null,
    }));
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

  /**
   * Retry after an error bubble: keep prior user/assistant/tool history and continue.
   * Does not wipe the failed turn's AI replies (unlike regenerate).
   */
  async function retryFromError(sessionId: string, errorMessageId: string): Promise<void> {
    pendingUserEdit.value = null;
    const state = stateFor(sessionId);
    const kept = dropErrorKeepHistory(state.messages, errorMessageId);
    if (!kept) return;
    const userMsg = findUserBeforeError(state.messages, errorMessageId);
    if (!userMsg) return;
    const continueTurn = turnHasProgressBeforeError(state.messages, errorMessageId);

    softHangReported.delete(sessionId);
    setSessionState(sessionId, withRunClock({
      ...state,
      messages: kept,
      streamingMessage: null,
      running: false,
      retryHint: null,
    }));

    if (continueTurn) {
      await sendPrompt(
        sessionId,
        t.retryContinueAgentPrompt,
        undefined,
        undefined,
        undefined,
        t.retryContinue,
      );
      return;
    }

    // Error before any assistant/tool output: re-drive the same user turn without
    // duplicating the user bubble or clearing earlier conversation.
    await resumePrompt(sessionId, userMsg);
  }

  /** Send a prompt to the worker without appending another user message to the transcript. */
  async function resumePrompt(
    sessionId: string,
    userMsg: Extract<ChatMessage, { role: "user" }>,
  ): Promise<void> {
    // New round: clear the previous round's todos before re-driving the prompt.
    useSessionWidgetsStore().resetTodosForSession(sessionId);
    const images = userMsg.images?.map((img) => {
      const raw = img.dataUrl.replace(/^data:[^;]+;base64,/, "");
      return { type: "image" as const, data: raw, mimeType: img.mimeType };
    });
    const promptImages = toPromptImages(images);
    setSessionState(sessionId, withRunClock(
      {
        ...stateFor(sessionId),
        running: true,
        streamingMessage: null,
        retryHint: null,
        nextToolOrder: 1,
        pendingAskUser: null,
      },
      { activity: true },
    ));
    try {
      await sessionsStore.sendCommand(sessionId, {
        type: "prompt",
        message: userMsg.text,
        images: promptImages,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setSessionState(sessionId, reduceChatEvent(stateFor(sessionId), {
        type: "prompt_error",
        sessionId,
        errorMessage: raw,
      }));
    }
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
    activeWaitState,
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
    autoRecover,
  };
});

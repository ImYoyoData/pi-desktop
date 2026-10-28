import { create } from "zustand";
import type {
	AgentEvent,
	ElementCitation,
	PromptImageContent,
	SessionHistoryMessage,
} from "../../../shared/protocol";
import { toPromptCitations, toPromptImages, SESSION_HISTORY_INITIAL_LIMIT, SESSION_HISTORY_PAGE_SIZE } from "../../../shared/protocol";
import { createHiddenEventSink } from "@renderer/utils/hidden-event-buffer";
import { getMessage } from "@renderer/services/feedback";
import {
	appendUserMessage,
	clearPendingAskUser,
	clearPendingExtensionUi,
	clearPendingPermission,
	createChatState,
	hasLiveTurnState,
	reduceChatEvent,
	setPendingAskUser,
	setPendingExtensionUi,
	setPendingPermission,
	withRunClock,
	type ChatMessage,
	type ChatRetryHint,
	type ChatState,
	type ChatUserImage,
} from "./chat-reducer";
import {
	stripInjectedBlocks,
	type LegacyModeTagKind,
} from "../../../shared/injected-blocks";
import { useSessionsStore } from "./sessions";
import { useCheckpointStore } from "./checkpoint";
import { useComposerStore } from "./composer";
import { useNotifyStore } from "./notify";
import { useSessionWidgetsStore } from "./session-widgets";
import { useWorkspaceStore } from "./workspace";
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
	isAskUserAskCancelled,
	type AskUserAnswerDraft,
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
import {
	isPermissionAskCancelled,
	type PermissionAskPrompt,
	type PermissionAskReply,
} from "../../../shared/permissions";

export type {
	ChatMessage,
	ChatState,
	ChatUserImage,
	ChatRetryHint,
} from "./chat-reducer";
export {
	appendUserMessage,
	clearPendingAskUser,
	clearPendingExtensionUi,
	createChatState,
	hasLiveTurnState,
	reduceChatEvent,
	setPendingAskUser,
	setPendingExtensionUi,
} from "./chat-reducer";

/** In-progress re-edit of a published user bubble (messages stay until commit/send). */
export type PendingUserEdit = {
	sessionId: string;
	messageId: string;
};

type OlderCursor = {
	hasMore: boolean;
	cursor: string | null;
	loading: boolean;
};

type ChatBase = {
	bySession: Record<string, ChatState>;
	/**
	 * 每个会话的「更早历史」游标：是否还有、下一页从哪一条取、是否正在取。
	 *
	 * 初始只装尾部一页（见 SESSION_HISTORY_INITIAL_LIMIT），往上的历史由用户主动
	 * 翻页加载。超长会话一次性全量载入会把渲染进程堆撑爆，这是内存治理的一环。
	 */
	olderBySession: Record<string, OlderCursor>;
	/**
	 * Sessions with a stop in flight.
	 *
	 * Stopping is an RPC to the worker, and a worker that is busy (long tool call,
	 * big session write) may not get to it for a while. Without this the Stop
	 * button just sat there looking dead for the whole wait, which read as the app
	 * having frozen; the UI now shows the request was received immediately.
	 */
	stoppingBySession: Record<string, boolean>;
	pendingUserEdit: PendingUserEdit | null;
	historyLoadingId: string | null;
};

/** Fields for the long-running wait indicator (phase / silence / worker alive). */
export type ChatWaitState = {
	running: boolean;
	streamingMessage: ChatMessage | null;
	retryHint: ChatRetryHint | null;
	pendingAskUser: AskUserPrompt | null;
	pendingPermission: PermissionAskPrompt | null;
	pendingExtensionUi: ExtensionUiPending | null;
	turnStartedAt: number | null;
	phaseStartedAt: number | null;
	lastActivityAt: number | null;
	lastWorkerAliveAt: number | null;
	autoRecovering: boolean;
};

type ChatDerived = {
	historyLoading: boolean;
	activeMessages: ChatMessage[];
	activeStreaming: ChatMessage | null;
	activeRunning: boolean;
	/** The active session has a stop request in flight (worker not idle yet). */
	activeStopping: boolean;
	activeWaitState: ChatWaitState | null;
	activeRetryHint: ChatRetryHint | null;
	activePendingAskUser: AskUserPrompt | null;
	activePendingPermission: PermissionAskPrompt | null;
	activePendingExtensionUi: ExtensionUiPending | null;
};

type ElementTag = {
	url: string;
	host: string;
	label: string;
	content?: string;
	kind?: "file" | "url" | "element" | LegacyModeTagKind;
};

export type ChatStoreState = ChatBase &
	ChatDerived & {
		bindEvents: () => () => void;
		clearPendingAskUserFor: (sessionId: string) => void;
		clearPendingPermissionFor: (sessionId: string) => void;
		replyPermission: (reply: PermissionAskReply) => Promise<void>;
		readAskDraft: (requestId: string) => AskUserAnswerDraft | null;
		writeAskDraft: (requestId: string, draft: AskUserAnswerDraft) => void;
		readAskStep: (requestId: string) => number | null;
		writeAskStep: (requestId: string, step: number) => void;
		replyAskUser: (payload: AskUserAskReply) => Promise<void>;
		replyExtensionUi: (reply: ExtensionUiReply) => Promise<void>;
		beginHistoryLoad: (sessionId: string) => void;
		endHistoryLoad: (sessionId: string) => void;
		hydrateFromHistory: (
			sessionId: string,
			history: SessionHistoryMessage[],
			hasOlder?: boolean,
		) => void;
		loadOlderMessages: (sessionId: string) => Promise<number>;
		resyncActiveSession: () => Promise<void>;
		clearSession: (sessionId: string) => void;
		sendPrompt: (
			sessionId: string,
			message: string,
			citations?: ElementCitation[],
			images?: PromptImageContent[],
			elementTags?: ElementTag[],
			displayText?: string,
		) => Promise<void>;
		steer: (
			sessionId: string,
			message: string,
			images?: PromptImageContent[],
		) => Promise<void>;
		followUp: (sessionId: string, message: string) => Promise<void>;
		clearQueue: (sessionId: string) => Promise<void>;
		abort: (sessionId: string) => Promise<void>;
		truncateFrom: (sessionId: string, messageId: string) => Promise<void>;
		beginEditUser: (
			sessionId: string,
			messageId: string,
		) => Extract<ChatMessage, { role: "user" }> | null;
		cancelEditUser: () => void;
		isPendingEditMessage: (sessionId: string, messageId: string) => boolean;
		isPendingEditTail: (sessionId: string, messageId: string) => boolean;
		regenerate: (
			sessionId: string,
			assistantMessageId: string,
		) => Promise<void>;
		retryFromError: (
			sessionId: string,
			errorMessageId: string,
		) => Promise<void>;
		restoreTurn: (
			sessionId: string,
			messageId: string,
		) => Promise<{ ok: boolean }>;
		forkConversation: (
			sessionId: string,
			messageId: string,
		) => Promise<string | null>;
		autoRecover: (
			sessionId: string,
			reason: AutoRecoverReason,
		) => Promise<boolean>;
	};

function toChatImages(
	images?: PromptImageContent[],
): ChatUserImage[] | undefined {
	if (!images?.length) return undefined;
	const out: ChatUserImage[] = [];
	for (const img of images) {
		if (!img?.data) continue;
		const mimeType = img.mimeType || "image/png";
		out.push({ mimeType, dataUrl: `data:${mimeType};base64,${img.data}` });
	}
	return out.length ? out : undefined;
}

function waitStateOf(state: ChatState | undefined): ChatWaitState | null {
	if (!state) return null;
	if (!state.running && !state.autoRecovering) return null;
	return {
		running: state.running,
		streamingMessage: state.streamingMessage,
		retryHint: state.retryHint,
		pendingAskUser: state.pendingAskUser,
		pendingPermission: state.pendingPermission,
		pendingExtensionUi: state.pendingExtensionUi,
		turnStartedAt: state.turnStartedAt,
		phaseStartedAt: state.phaseStartedAt,
		lastActivityAt: state.lastActivityAt,
		lastWorkerAliveAt: state.lastWorkerAliveAt,
		autoRecovering: state.autoRecovering,
	};
}

function derive(base: ChatBase): ChatDerived {
	const id = useSessionsStore.getState().activeId;
	const state = id ? base.bySession[id] : undefined;
	const running = state?.running ?? false;
	return {
		historyLoading: Boolean(id && base.historyLoadingId === id),
		activeMessages: state?.messages ?? [],
		activeStreaming: state?.streamingMessage ?? null,
		activeRunning: running,
		activeStopping: Boolean(id && base.stoppingBySession[id] && running),
		activeWaitState: waitStateOf(state),
		activeRetryHint: state?.retryHint ?? null,
		activePendingAskUser: state?.pendingAskUser ?? null,
		activePendingPermission: state?.pendingPermission ?? null,
		activePendingExtensionUi: state?.pendingExtensionUi ?? null,
	};
}

export const useChatStore = create<ChatStoreState>()((set, get) => {
	const base: ChatBase = {
		bySession: {},
		olderBySession: {},
		stoppingBySession: {},
		pendingUserEdit: null,
		historyLoadingId: null,
	};

	/** requestId → UI draft kept across renderer reloads (恢复后可继续提交). */
	const askUserDrafts = new Map<string, AskUserAnswerDraft>();
	/** requestId → 当前题号，会话切换回来后仍停在原来那一题。 */
	const askUserSteps = new Map<string, number>();
	let pendingUiRecovered = false;
	const ASK_DRAFT_KEY = "pi-desktop:ask-user-drafts:v1";

	function readAskDraft(requestId: string): AskUserAnswerDraft | null {
		const mem = askUserDrafts.get(requestId);
		if (mem) return mem;
		try {
			const raw = sessionStorage.getItem(ASK_DRAFT_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw) as Record<string, AskUserAnswerDraft>;
			const draft = parsed?.[requestId];
			return draft && typeof draft === "object" ? draft : null;
		} catch {
			return null;
		}
	}

	function writeAskDraft(requestId: string, draft: AskUserAnswerDraft): void {
		askUserDrafts.set(requestId, draft);
		try {
			const raw = sessionStorage.getItem(ASK_DRAFT_KEY);
			const parsed = (raw ? JSON.parse(raw) : {}) as Record<string, AskUserAnswerDraft>;
			parsed[requestId] = draft;
			const keys = Object.keys(parsed).slice(-8);
		const trimmed: Record<string, AskUserAnswerDraft> = {};
		for (const k of keys) trimmed[k] = parsed[k]!;
		sessionStorage.setItem(ASK_DRAFT_KEY, JSON.stringify(trimmed));
		} catch {
			// ignore — best effort only
		}
	}

	function readAskStep(requestId: string): number | null {
		return askUserSteps.get(requestId) ?? null;
	}

	function writeAskStep(requestId: string, step: number): void {
		askUserSteps.set(requestId, step);
	}

	function clearAskUserDraft(requestId: string): void {
		askUserDrafts.delete(requestId);
		askUserSteps.delete(requestId);
		try {
			const raw = sessionStorage.getItem(ASK_DRAFT_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			delete parsed[requestId];
		sessionStorage.setItem(ASK_DRAFT_KEY, JSON.stringify(parsed));
		} catch {
			// ignore
		}
	}

	/** Sessions currently inside autoRecover (restart + resend). */
	const recoveringIds = new Set<string>();
	/** Soft-hang timeout already reported for this turn (avoid repeat errors). */
	const softHangReported = new Set<string>();
	/** Event-loop stall already reported for this episode (watchdog runs every 5s). */
	const stallReported = new Set<string>();
	/** Turns the user explicitly stopped — their prompt_done must NOT
	 *  auto-complete the (paused) todo list. */
	const stopIntentBySession = new Set<string>();
	/** Per-session prompt chain: sends are strictly serial per session so two
	 *  queued prompts never race the worker or corrupt the single-active
	 *  checkpoint (duplicate sends from the queue-edit path caused both). */
	const promptChain = new Map<string, Promise<unknown>>();
	/**
	 * 常驻内存的会话上限。切走的会话原本永远留在 bySession 里（只有删除会话才清），
	 * 长时间使用后渲染进程堆会线性增长直至 OOM。超出后按最久未使用驱逐空闲会话，
	 * 切回时从磁盘重新 hydrate。
	 */
	const MAX_CACHED_SESSIONS = 8;
	/** 会话状态最后一次 hydrate 的时间戳，用于 LRU 排序。 */
	const sessionHydratedAt = new Map<string, number>();

	function commit(patch: Partial<ChatBase>): void {
		set((state) => {
			const next = { ...state, ...patch };
			return { ...next, ...derive(next) };
		});
	}

	function resetOlderCursor(
		sessionId: string,
		hasMore: boolean,
		firstMessageId: string | null,
	): void {
		commit({
			olderBySession: {
				...get().olderBySession,
				[sessionId]: { hasMore, cursor: firstMessageId, loading: false },
			},
		});
	}

	/**
	 * 取一页更早的历史并前插到消息列表头部，返回前插的条数。
	 *
	 * 返回条数供列表平移渲染窗口，保证视口内容不因前插而跳动。空页 / 出错都
	 * 视为「没有更早了」，不会反复触发加载。
	 */
	async function loadOlderMessages(sessionId: string): Promise<number> {
		const older = get().olderBySession[sessionId];
		if (!older || older.loading || !older.hasMore || !older.cursor) return 0;
		const row = useSessionsStore
			.getState()
			.sessions.find((s) => s.id === sessionId);
		if (!row?.filePath) return 0;

		commit({
			olderBySession: {
				...get().olderBySession,
				[sessionId]: { ...older, loading: true },
			},
		});
		try {
			const page = await window.api.sessions.history(row.filePath, {
				limit: SESSION_HISTORY_PAGE_SIZE,
				beforeId: older.cursor,
			});
			const state = get().bySession[sessionId];
			if (!state || !page.messages.length) {
				commit({
					olderBySession: {
						...get().olderBySession,
						[sessionId]: { ...older, hasMore: false },
					},
				});
				return 0;
			}
			const prepended = page.messages.map(mapHistoryRow);
			commit({
				bySession: {
					...get().bySession,
					[sessionId]: {
						...state,
						messages: [...prepended, ...state.messages],
					},
				},
				olderBySession: {
					...get().olderBySession,
					[sessionId]: {
						hasMore: page.hasMore,
						cursor: prepended[0]!.id,
						loading: false,
					},
				},
			});
			return prepended.length;
		} catch (err) {
			console.error("[chat] load older history failed:", err);
			commit({
				olderBySession: {
					...get().olderBySession,
					[sessionId]: { ...older, loading: false },
				},
			});
			return 0;
		}
	}
	let softHangTimer: ReturnType<typeof setInterval> | null = null;
	/** 会话事件订阅的解绑函数（已绑定时非 null，保证幂等）。 */
	let unbindEvents: (() => void) | null = null;
	const agentEventSink = createHiddenEventSink<AgentEvent>({
		apply: (event) => applyEvent(event),
		isHidden: () => document.hidden,
		onError: (err) => console.error("[chat] buffered event apply failed", err),
	});

	function stateFor(sessionId: string): ChatState {
		return get().bySession[sessionId] ?? createChatState();
	}

	/** Commit chat state and reset phaseStartedAt when the wait phase changes. */
	function setSessionState(sessionId: string, next: ChatState): void {
		const prev = get().bySession[sessionId] ?? createChatState();
		commit({
			bySession: {
				...get().bySession,
				[sessionId]: syncPhaseClock(prev, next),
			},
		});
	}

	function beginHistoryLoad(sessionId: string): void {
		commit({ historyLoadingId: sessionId });
	}

	function endHistoryLoad(sessionId: string): void {
		if (get().historyLoadingId === sessionId) {
			commit({ historyLoadingId: null });
		}
	}

	function mapHistoryRow(row: SessionHistoryMessage): ChatMessage {
		if (row.role === "user") {
			return {
				id: row.id,
				role: "user" as const,
				text: stripInjectedBlocks(row.text),
				...(row.images?.length ? { images: row.images } : {}),
				...(row.elementTags?.length ? { elementTags: row.elementTags } : {}),
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
				...(row.durationMs != null ? { durationMs: row.durationMs } : {}),
				...(row.nestedCalls?.length ? { nestedCalls: row.nestedCalls } : {}),
			};
		}
		if (row.role === "summary") {
			return {
				id: row.id,
				role: "summary" as const,
				text: row.text,
				kind: row.kind,
				...(row.tokensBefore != null ? { tokensBefore: row.tokensBefore } : {}),
			};
		}
		return {
			id: row.id,
			role: "assistant" as const,
			text: row.text,
			...(row.thinking ? { thinking: row.thinking } : {}),
			...(row.model ? { model: row.model } : {}),
			...(row.thinkingLevel ? { thinkingLevel: row.thinkingLevel } : {}),
			...(row.usage ? { usage: row.usage } : {}),
			...(row.durationMs != null ? { durationMs: row.durationMs } : {}),
			...(row.thinkingDurationMs != null
				? { thinkingDurationMs: row.thinkingDurationMs }
				: {}),
		};
	}

	function clearPendingAskUserFor(sessionId: string): void {
		setSessionState(sessionId, clearPendingAskUser(stateFor(sessionId)));
	}

	function setPendingAskUserFor(prompt: AskUserPrompt): void {
		if (!prompt.sessionId) return;
		const cur = stateFor(prompt.sessionId).pendingAskUser;
		if (cur?.requestId === prompt.requestId) return;
		setSessionState(
			prompt.sessionId,
			setPendingAskUser(stateFor(prompt.sessionId), prompt),
		);
	}

	function clearPendingPermissionFor(sessionId: string): void {
		setSessionState(sessionId, clearPendingPermission(stateFor(sessionId)));
	}

	/** 审批条按 requestId 去重：重连后 main 会重发同一条询问。 */
	function setPendingPermissionFor(prompt: PermissionAskPrompt): void {
		if (!prompt.sessionId) return;
		const cur = stateFor(prompt.sessionId).pendingPermission;
		if (cur?.requestId === prompt.requestId) return;
		setSessionState(
			prompt.sessionId,
			setPendingPermission(stateFor(prompt.sessionId), prompt),
		);
	}

	async function replyPermission(reply: PermissionAskReply): Promise<void> {
		const id = useSessionsStore.getState().activeId;
		if (id) clearPendingPermissionFor(id);
		const res = await window.api.sessions.permissionReply(reply);
		if (!res?.ok) throw new Error(res?.reason ?? "permission reply rejected");
	}

	/**
	 * Reload / language-switch wipes renderer memory while main keeps the
	 * pending asks. Pull them back so strips reappear; replies reuse the
	 * original requestId so recovered strips stay submittable. Ask drafts
	 * stored in sessionStorage survive reload; when main no longer holds a
	 * request (e.g. app restart) its strip is gone for good — the worker turn
	 * already failed, so just surface that instead of a dead prompt.
	 */
	async function recoverPendingUi(): Promise<void> {
		if (pendingUiRecovered) return;
		pendingUiRecovered = true;
		let snapshot;
		try {
			snapshot = await window.api.sessions.pendingUi();
		} catch {
			return;
		}
		if (!snapshot) return;
		for (const ask of snapshot.asks ?? []) {
			if (!ask?.requestId || !ask?.sessionId || !ask?.questions?.length) continue;
			setPendingAskUserFor({
				sessionId: ask.sessionId,
				requestId: ask.requestId,
				questions: ask.questions,
			});
		}
		for (const dialog of snapshot.extensionDialogs ?? []) {
			if (!dialog || !("requestId" in dialog) || !dialog.requestId) continue;
			if (stateFor(dialog.sessionId).pendingExtensionUi?.requestId === dialog.requestId) continue;
			setPendingExtensionUiFor(dialog);
		}
		for (const prompt of snapshot.permissions ?? []) {
			if (!prompt || !prompt.requestId) continue;
			setPendingPermissionFor(prompt);
		}
		if (
			snapshot.asks?.length ||
			snapshot.extensionDialogs?.length ||
			snapshot.permissions?.length
		) {
			const notify = useNotifyStore.getState();
			if (notify.soundEnabled) {
				void notify.playChime();
			}
		}
	}

	function setPendingExtensionUiFor(req: ExtensionUiPending): void {
		setSessionState(
			req.sessionId,
			setPendingExtensionUi(stateFor(req.sessionId), req),
		);
	}

	function clearPendingExtensionUiFor(sessionId: string): void {
		setSessionState(sessionId, clearPendingExtensionUi(stateFor(sessionId)));
	}

	async function replyAskUser(payload: AskUserAskReply): Promise<void> {
		const id = useSessionsStore.getState().activeId;
		if (id) clearPendingAskUserFor(id);
		clearAskUserDraft(payload.requestId);
		const res = await window.api.sessions.askUserReply(payload);
		if (!res?.ok) throw new Error(res?.reason ?? "ask_user reply rejected");
	}

	async function replyExtensionUi(reply: ExtensionUiReply): Promise<void> {
		const id = useSessionsStore.getState().activeId;
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
			const notify = useNotifyStore.getState();
			if (notify.soundEnabled) {
				void notify.playChime();
			}
			return;
		}
		if (event.method === "notify") {
			// Toast for the active session only to avoid noise from background workers.
			if (event.sessionId !== useSessionsStore.getState().activeId) return;
			// Todo / plan snapshots belong in the persistent panel — don't also toast.
			if (
				/(?:待办|计划进度|Todos\s+\d|☑|☐)/.test(event.message) &&
				event.message.includes("\n")
			) {
				return;
			}
			const message = getMessage();
			if (event.notifyType === "error") message.error(event.message);
			else if (event.notifyType === "warning") message.warning(event.message);
			else message.info(event.message);
			return;
		}
		if (event.method === "setEditorText") {
			if (event.sessionId !== useSessionsStore.getState().activeId) return;
			useComposerStore.setState({ draft: event.text });
			return;
		}
		if (event.method === "setWidget") {
			useSessionWidgetsStore
				.getState()
				.setWidget(event.sessionId, event.widgetKey, event.widgetLines);
			return;
		}
		// setStatus / setTitle: reserved for future chrome.
	}

	/**
	 * 回合结束（正常结束或失败）统一收尾待办：用户主动停止则冻结成暂停列表，
	 * 否则把模型没回写的项标为「未回写」，不让面板停在「进行中」。
	 */
	function settleTodosForSession(sessionId: string): void {
		const widgets = useSessionWidgetsStore.getState();
		if (stopIntentBySession.delete(sessionId)) {
			widgets.pauseTodosForSession(sessionId);
		} else {
			widgets.finalizeTodosForSession(sessionId);
		}
	}

	function applyEvent(event: AgentEvent): void {
		const sessionId = event.sessionId;
		try {
			setSessionState(sessionId, reduceChatEvent(stateFor(sessionId), event));
		} catch (err) {
			// 一条事件归约失败不能影响后续事件（也避免异常穿透 ipcRenderer 回调）。
			console.error(`[chat] reduce failed for ${event.type}:`, err);
			return;
		}

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
				const widgets = useSessionWidgetsStore.getState();
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
			void useCheckpointStore.getState().finishActive(sessionId);
			softHangReported.delete(sessionId);
			stallReported.delete(sessionId);
			if (event.type === "prompt_done") {
				resetAutoRecoverBudget(sessionId);
			} else {
				clearAutoRecovering(sessionId);
			}
		}
		if (event.type === "prompt_done") {
			// Turn over: clear the in-flight stop marker first so the Stop button
			// returns to Send on the same paint that ends the turn.
			commit({
				stoppingBySession: { ...get().stoppingBySession, [sessionId]: false },
			});
			settleTodosForSession(sessionId);
			void useNotifyStore.getState().onTurnComplete({
				title: notifyTitleOf(sessionId),
				body: t.notifyTurnCompleteBody,
				sessionId,
			});
		} else if (event.type === "prompt_error") {
			// 失败同样结束了回合：待办要落到 paused / 未回写，不能停在「进行中」。
			settleTodosForSession(sessionId);
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

	function notifyTitleOf(sessionId: string): string {
		const row = useSessionsStore
			.getState()
			.sessions.find((s) => s.id === sessionId);
		const label = row?.name?.trim() || row?.firstMessage?.trim() || "";
		return label ? label.slice(0, 40) : t.appName;
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
		if (state.pendingAskUser || state.pendingExtensionUi || state.pendingPermission) {
			return false;
		}
		if (!canAutoRecoverForReason(state.autoRecoverCount, reason)) {
			if (reason === "soft_hang") {
				setSessionState(
					sessionId,
					reduceChatEvent(state, {
						type: "prompt_error",
						sessionId,
						errorMessage: t.autoRecoverGaveUp,
					}),
				);
			} else {
				getMessage().warning(t.autoRecoverGaveUp);
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
				await useSessionsStore.getState().restartWorker(sessionId, null);
			} catch (err) {
				getMessage().error(err instanceof Error ? err.message : String(err));
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

			setSessionState(
				sessionId,
				withRunClock({
					...after,
					messages: after.messages.slice(0, userIdx),
					streamingMessage: null,
					running: false,
					retryHint: null,
					// Banner only covers restart+resend kickoff — not the whole retried turn.
					autoRecovering: false,
				}),
			);

			getMessage().info(
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

	/**
	 * 隐藏期间窗口定时器被 Chromium 节流，会话事件缓冲的消费随之滞后，
	 * lastWorkerAliveAt 会停在旧值上，把「UI 没收到心跳」误报成「worker 心跳异常」。
	 * 恢复可见时以当前时刻重置基准，真伪交给随后到达的心跳确认。
	 */
	function resetWorkerAliveClocks(): void {
		const now = Date.now();
		for (const [sessionId, state] of Object.entries(get().bySession)) {
			if (!state?.running || state.lastWorkerAliveAt == null) continue;
			setSessionState(sessionId, { ...state, lastWorkerAliveAt: now });
		}
	}

	function handleVisibilityChange(): void {
		if (document.hidden) return;
		agentEventSink.flushNow();
		resetWorkerAliveClocks();
	}

	function checkSoftHangSessions(): void {
		// 隐藏窗口的定时器同样被节流：事件消费滞后会让「没收到心跳」看起来像 stall
		// 或软挂，后台不做静默判定。真死 / 真卡由主进程（不受窗口隐藏影响）的
		// stall / exit 事件兜底。
		if (document.hidden) return;
		const now = Date.now();
		for (const [sessionId, state] of Object.entries(get().bySession)) {
			if (!state?.running || state.autoRecovering || recoveringIds.has(sessionId))
				continue;
			if (softHangReported.has(sessionId)) continue;
			const waitingUser = Boolean(
				state.pendingAskUser ||
					state.pendingExtensionUi ||
					state.pendingPermission,
			);
			const outputSilenceMs = agentOutputSilenceMs(state, now);
			const workerSilenceMs = agentWorkerSilenceMs(state, now);
			// Event-loop stall (heartbeats AND output dead) — full restart + resend.
			// Mirrors the main-process worker_stall event as a renderer-side fallback
			// (covers cases where the main timer was delayed). Deduped by recoveringIds
			// and stallReported (watchdog fires every 5s).
			if (
				shouldStallRecover({
					running: state.running,
					waitingUser,
					outputSilenceMs,
					workerSilenceMs,
				})
			) {
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
			setSessionState(
				sessionId,
				reduceChatEvent(stateFor(sessionId), {
					type: "prompt_error",
					sessionId,
					errorMessage: t.modelResponseTimeout,
				}),
			);
			clearAutoRecovering(sessionId);
		} catch (err) {
			softHangReported.delete(sessionId);
			getMessage().error(err instanceof Error ? err.message : String(err));
		}
	}

	/**
	 * 会话重新载入时用主进程的会话状态校准 running：
	 * 事件丢失（renderer 重载、HMR、断线）不应让 UI 永远停在「运行中」，
	 * 否则检查点分隔线与派生/还原按钮会一直不显示。
	 */
	function reconcileRunning(sessionId: string, state: ChatState): ChatState {
		if (!state.running) return state;
		const row = useSessionsStore
			.getState()
			.sessions.find((s) => s.id === sessionId);
		if (!row || row.status === "running" || row.status === "stuck") return state;
		return { ...state, running: false, streamingMessage: null, retryHint: null };
	}

	/**
	 * 磁盘历史 + 内存 live 尾部：会话运行中重载 renderer 时事件先于 hydrate 到达，
	 * live 里只有流式事件、没有历史，直接采用 live 会丢掉整段磁盘历史。
	 * live 带有磁盘历史锚点时按锚点拼接更新尾部；否则用 live 的当前轮
	 * （最后一条 user 起）覆盖磁盘历史的尾部，前段历史始终保留。
	 */
	function mergeHistoryWithLive(
		mapped: ChatMessage[],
		liveMessages: ChatMessage[],
	): ChatMessage[] {
		if (!liveMessages.length) return mapped;
		if (!mapped.length) return liveMessages;
		const diskTailId = mapped.at(-1)!.id;
		const anchorIdx = liveMessages.findIndex((m) => m.id === diskTailId);
		if (anchorIdx >= 0) {
			// live 由同一份磁盘历史 hydrate 而来：保留对象身份，只追加更新的尾部。
			if (anchorIdx === liveMessages.length - 1) return liveMessages;
			return [...mapped, ...liveMessages.slice(anchorIdx + 1)];
		}
		const liveUser = liveMessages.findLastIndex((m) => m.role === "user");
		const liveUserMsg = liveUser >= 0 ? liveMessages[liveUser] : undefined;
		if (liveUserMsg?.role !== "user") return mapped;
		const text = liveUserMsg.text;
		const diskUser = mapped.findLastIndex(
			(m) => m.role === "user" && m.text === text,
		);
		const head = diskUser >= 0 ? mapped.slice(0, diskUser) : mapped;
		return [...head, ...liveMessages.slice(liveUser)];
	}

	/**
	 * 以磁盘历史为唯一真相重建会话状态：消息已落盘，本轮一定已结束。
	 * hydrate（切会话）与 resync（事件丢失兜底）共用，避免两处终态字段漂移。
	 */
	function settledStateFromHistory(
		sessionId: string,
		history: SessionHistoryMessage[],
		hasOlder = false,
	): void {
		commit({
			bySession: {
				...get().bySession,
				[sessionId]: {
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
				},
			},
		});
		softHangReported.delete(sessionId);
		stallReported.delete(sessionId);
		resetOlderCursor(sessionId, hasOlder, history[0]?.id ?? null);
	}

	function hydrateFromHistory(
		sessionId: string,
		history: SessionHistoryMessage[],
		hasOlder = false,
	): void {
		commit({ pendingUserEdit: null });
		sessionHydratedAt.set(sessionId, Date.now());
		// Restore persisted checkpoint summaries so history keeps its revert
		// buttons across session switches / restarts.
		void useCheckpointStore.getState().loadSessionSummaries(sessionId);
		const mapped = history.map(mapHistoryRow);
		const live = get().bySession[sessionId];
		if (live && hasLiveTurnState(live)) {
// Session already has a live turn in memory (streaming tail / ask_user
			// / extension strip). The disk page read on session switch
			// lags the live turn, so replacing state would drop the pending prompt
			// and any un-flushed stream tail; keep it until the turn settles.
softHangReported.delete(sessionId);
			const merged = reconcileRunning(sessionId, {
				...live,
				messages: mergeHistoryWithLive(mapped, live.messages),
			});
			commit({
				bySession: { ...get().bySession, [sessionId]: merged },
			});
			// live 可能带着用户已翻到的更早历史，游标跟着合并后的第一条走。
			resetOlderCursor(sessionId, hasOlder, merged.messages[0]?.id ?? null);
			return;
		}
		// Returning to a session we already hold in memory: when the disk page is
		// the tail of what's already loaded (user visited before / loaded older
		// pages), keep the existing array — message objects stay identical so
		// tool-card parse caches and loaded older pages survive the round-trip.
		if (
			live &&
			live.messages.length >= mapped.length &&
			mapped.length > 0 &&
			live.messages
				.slice(-mapped.length)
				.every((m, i) => m.id === mapped[i]!.id)
		) {
			softHangReported.delete(sessionId);
			commit({
				bySession: {
					...get().bySession,
					[sessionId]: reconcileRunning(sessionId, live),
				},
			});
			resetOlderCursor(sessionId, hasOlder, live.messages[0]?.id ?? null);
			return;
		}
		settledStateFromHistory(sessionId, history, hasOlder);
		evictIdleSessions(sessionId);
	}

	/**
	 * 用主进程权威状态对账当前会话，补回丢失的流式内容。
	 *
	 * 会话事件由主进程单向推送，渲染端无法补发；任何一次丢失（渲染重载、订阅
	 * 空窗）都会让本地 running 与主进程永久不一致——界面停在「等待模型响应」，
	 * 而模型其实早已回复完。聊天视图重新可见时做一次兜底：主进程已空闲而本地还在
	 * 转，就丢掉 live 状态，按磁盘历史重建（live 只剩半截流式，并不可信）。
	 */
	async function resyncActiveSession(): Promise<void> {
		try {
			await doResyncActiveSession();
		} catch (err) {
			// 对账是兜底，失败就保持现状，不能反过来弄坏已能用的界面。
			console.error("[chat] session resync failed:", err);
		}
	}

	async function doResyncActiveSession(): Promise<void> {
		const sessions = useSessionsStore.getState();
		const sessionId = sessions.activeId;
		if (!sessionId) return;
		const row = sessions.sessions.find((s) => s.id === sessionId);
		if (!row?.filePath) return;
		const state = get().bySession[sessionId];
		if (!state?.running && !state?.autoRecovering) return;

		const status = await window.api.sessions.status(sessionId, row.cwd);
		if (status === null || status === "running" || status === "stuck") return;

		sessions.applyStatus(sessionId, status);
		const page = await window.api.sessions.history(row.filePath, {
			limit: SESSION_HISTORY_INITIAL_LIMIT,
		});
		// 事件丢失连带丢了 prompt_done 的副作用，逐项补齐终态。
		void useCheckpointStore.getState().loadSessionSummaries(sessionId);
		settledStateFromHistory(sessionId, page.messages, page.hasMore);
		recoveringIds.delete(sessionId);
		commit({
			stoppingBySession: { ...get().stoppingBySession, [sessionId]: false },
		});
		stopIntentBySession.delete(sessionId);
		void useCheckpointStore.getState().finishActive(sessionId);
		useSessionWidgetsStore.getState().finalizeTodosForSession(sessionId);
	}

	/**
	 * 清掉一个会话在渲染进程里的全部常驻数据。
	 *
	 * 既是「删除会话」的收尾，也是内存驱逐的执行体——bySession 里的消息只是其中一项，
	 * 配套的 Map / Set / reactive 记录不一起清，内存并不会真的降下来。
	 */
	function clearSession(sessionId: string): void {
		const state = get();
		const bySession = { ...state.bySession };
		delete bySession[sessionId];
		const olderBySession = { ...state.olderBySession };
		delete olderBySession[sessionId];
		commit({
			bySession,
			olderBySession,
			pendingUserEdit:
				state.pendingUserEdit?.sessionId === sessionId
					? null
					: state.pendingUserEdit,
			stoppingBySession: { ...state.stoppingBySession, [sessionId]: false },
		});
		sessionHydratedAt.delete(sessionId);
		softHangReported.delete(sessionId);
		stallReported.delete(sessionId);
		stopIntentBySession.delete(sessionId);
		recoveringIds.delete(sessionId);
		promptChain.delete(sessionId);
		askUserDrafts.delete(sessionId);
		askUserSteps.delete(sessionId);
		useCheckpointStore.getState().clearSession(sessionId);
	}

	/**
	 * 内存治理：把常驻的空闲会话压到上限以内，超出部分按最久未使用依次驱逐。
	 *
	 * 驱逐后切回该会话会从磁盘重新 hydrate，代价只是一次 IPC + 解析。运行中的会话
	 * 永不驱逐——内存里的流式内容是唯一真相，磁盘可能还没落盘。若全部候选都在运行
	 * （实际最多一两轮），本轮不驱逐，等它们结束后下次 hydrate 再回收。
	 */
	function evictIdleSessions(keepSessionId: string): void {
		const ids = Object.keys(get().bySession);
		let overflow = ids.length - MAX_CACHED_SESSIONS;
		if (overflow <= 0) return;
		const evictable = ids
			.filter((id) => id !== keepSessionId)
			.filter((id) => !hasLiveTurnState(get().bySession[id]!))
			.sort((a, b) => (sessionHydratedAt.get(a) ?? 0) - (sessionHydratedAt.get(b) ?? 0));
		for (const id of evictable) {
			if (overflow <= 0) break;
			clearSession(id);
			overflow--;
		}
	}

	/**
	 * 静默看门狗：会话长时间无输出时判定软挂 / 事件循环卡死并自动恢复。
	 * 返回停止函数，由应用级 bootstrap 持有。
	 */
	function startSoftHangWatchdog(): () => void {
		if (softHangTimer) return () => {};
		softHangTimer = setInterval(() => checkSoftHangSessions(), 5_000);
		return () => {
			if (!softHangTimer) return;
			clearInterval(softHangTimer);
			softHangTimer = null;
		};
	}

	/**
	 * 注册进程级 IPC 订阅，返回解绑函数。
	 *
	 * 只能由应用级 bootstrap（app-events）调用：会话事件是单向推送，组件一旦
	 * 卸载就再也补不回来。ChatPanel 会被 `v-if` 反复销毁重建（切换拉取请求视图），
	 * 把订阅挂在组件生命周期上会让事件流出现空窗，界面永久停在「等待模型响应」。
	 */
	function bindEvents(): () => void {
		if (unbindEvents) return unbindEvents;
		const stopCheckpoint = useCheckpointStore.getState().bindEvents();
		const stopWatchdog = startSoftHangWatchdog();
		const off = window.api.sessions.onEvent((event) => {
			agentEventSink.push(event);
		});
		document.addEventListener("visibilitychange", handleVisibilityChange);
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
			const notify = useNotifyStore.getState();
			if (notify.soundEnabled) {
				void notify.playChime();
			}
		});
		const offExtensionUi = window.api.sessions.onExtensionUi((event) => {
			handleExtensionUiEvent(event);
		});
		const offPermission = window.api.sessions.onPermission((req) => {
			if (isPermissionAskCancelled(req)) {
				const pending = stateFor(req.sessionId).pendingPermission;
				if (pending?.requestId === req.requestId) {
					clearPendingPermissionFor(req.sessionId);
				}
				return;
			}
			setPendingPermissionFor(req);
			const notify = useNotifyStore.getState();
			if (notify.soundEnabled) {
				void notify.playChime();
			}
		});
		void recoverPendingUi();
		unbindEvents = () => {
			unbindEvents = null;
			stopCheckpoint();
			stopWatchdog();
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			off();
			offAskUser();
			offExtensionUi();
			offPermission();
		};
		return unbindEvents;
	}

	async function sendPrompt(
		sessionId: string,
		message: string,
		citations?: ElementCitation[],
		images?: PromptImageContent[],
		elementTags?: ElementTag[],
		/** Bubble text (defaults to `message`). Agent always receives `message`. */
		displayText?: string,
	): Promise<void> {
		// Strictly serialize prompts per session: a second prompt fired while
		// one is in flight would race the worker and corrupt the single-active
		// checkpoint (both user bubbles ended up with revert buttons).
		const prev = promptChain.get(sessionId) ?? Promise.resolve();
		const run = prev.then(() =>
			sendPromptSerial(
				sessionId,
				message,
				citations,
				images,
				elementTags,
				displayText,
			),
		);
		promptChain.set(
			sessionId,
			run.catch(() => undefined),
		);
		await run;
	}

	async function sendPromptSerial(
		sessionId: string,
		message: string,
		citations?: ElementCitation[],
		images?: PromptImageContent[],
		elementTags?: ElementTag[],
		/** Bubble text (defaults to `message`). Agent always receives `message`. */
		displayText?: string,
	): Promise<void> {
		const promptImages = toPromptImages(images);
		const promptCitations = toPromptCitations(citations);
		const bubbleText = displayText !== undefined ? displayText : message;

		// Re-edit commit: replace that bubble and everything after it (UI + agent tree).
		const edit = get().pendingUserEdit;
		commit({ pendingUserEdit: null });
		if (edit?.sessionId === sessionId) {
			const before = stateFor(sessionId);
			const located = locateUserTurn(before, edit.messageId);
			if (located) {
				setSessionState(
					sessionId,
					withRunClock({
						...before,
						messages: before.messages.slice(0, located.cutIdx),
						streamingMessage: null,
						running: false,
						retryHint: null,
					}),
				);
				try {
					await useSessionsStore.getState().sendCommand(sessionId, {
						type: "rollback_user",
						userIndex: located.userIndex,
					});
				} catch {
					// Agent may already be past that leaf — continue with the new prompt.
				}
			}
		}

		// A new task starts a clean slate: drop the previous round's todos so
		// fresh items never accumulate on top of the old list.
		useSessionWidgetsStore.getState().resetTodosForSession(sessionId);
		setSessionState(
			sessionId,
			appendUserMessage(
				stateFor(sessionId),
				bubbleText,
				toChatImages(promptImages),
				elementTags?.length ? elementTags : undefined,
			),
		);
		const last = stateFor(sessionId).messages.at(-1);
		if (last?.role === "user") {
			// Must finish begin (baseline snapshot) before the agent starts writing files.
			await useCheckpointStore.getState().begin(sessionId, last.id);
		}
		// Persist attachment chips so they survive a session reload (sidecar keyed by agent text).
		if (elementTags?.length) {
			void window.api.sessions
				.setUserMessageMeta(sessionId, message, elementTags)
				.catch(() => {
					// best-effort — chips degrade to text if the sidecar write fails
				});
		}
		try {
			await useSessionsStore.getState().sendCommand(sessionId, {
				type: "prompt",
				message,
				citations: promptCitations,
				images: promptImages,
			});
		} catch (err) {
			void useCheckpointStore.getState().finishActive(sessionId);
			const raw = err instanceof Error ? err.message : String(err);
			const state = stateFor(sessionId);
			setSessionState(
				sessionId,
				reduceChatEvent(state, {
					type: "prompt_error",
					sessionId,
					errorMessage: raw,
				}),
			);
		}
	}

	async function steer(
		sessionId: string,
		message: string,
		images?: PromptImageContent[],
	): Promise<void> {
		clearPendingAskUserFor(sessionId);
		await useSessionsStore.getState().sendCommand(sessionId, {
			type: "steer",
			message,
			...(images?.length ? { images } : {}),
		});
	}

	async function followUp(sessionId: string, message: string): Promise<void> {
		clearPendingAskUserFor(sessionId);
		await useSessionsStore.getState().sendCommand(sessionId, {
			type: "follow_up",
			message,
		});
	}

	/** 清空 pi 侧的引导 / 排队消息；本地队列由界面一并清理。 */
	async function clearQueue(sessionId: string): Promise<void> {
		await useSessionsStore.getState().sendCommand(sessionId, {
			type: "clear_queue",
		});
	}

	async function abort(sessionId: string): Promise<void> {
		// Stop dismisses any pending interactive strip (ask_user / permission /
		// extension UI) immediately — don't wait for the worker cancel broadcast.
		setSessionState(
			sessionId,
			clearPendingAskUser(clearPendingExtensionUi(stateFor(sessionId))),
		);

		// User-initiated stop: freeze the todo round as paused — the user
		// decides to continue or delete; never auto-complete it.
		stopIntentBySession.add(sessionId);
		// Light up the stopping UI before the RPC: the worker may take a while to
		// reach the abort (busy tool call), and a silent button reads as a freeze.
		commit({
			stoppingBySession: { ...get().stoppingBySession, [sessionId]: true },
		});

		const sessions = useSessionsStore.getState();
		const row = sessions.sessions.find((s) => s.id === sessionId);
		if (row?.status === "stuck") {
			await sessions.killWorker(sessionId, null);
			const state = stateFor(sessionId);
			setSessionState(
				sessionId,
				withRunClock({
					...state,
					running: false,
					streamingMessage: null,
					retryHint: null,
				}),
			);
			commit({
				stoppingBySession: { ...get().stoppingBySession, [sessionId]: false },
			});
			return;
		}
		try {
			await sessions.sendCommand(sessionId, { type: "abort" });
		} finally {
			// The turn may still be winding down; `prompt_done` clears running and
			// with it activeStopping. Only drop the flag early if the worker has
			// already gone idle, so the button never gets stuck in "stopping".
			if (!stateFor(sessionId).running) {
				commit({
					stoppingBySession: { ...get().stoppingBySession, [sessionId]: false },
				});
			}
		}
	}

	async function truncateFrom(
		sessionId: string,
		messageId: string,
	): Promise<void> {
		const state = stateFor(sessionId);
		const idx = state.messages.findIndex((m) => m.id === messageId);
		if (idx < 0) return;
		setSessionState(
			sessionId,
			withRunClock({
				...state,
				messages: state.messages.slice(0, idx),
				streamingMessage: null,
				running: false,
				retryHint: null,
			}),
		);
	}

	/** Start re-edit: keep chat intact; truncate only on commit (send). */
	function beginEditUser(
		sessionId: string,
		messageId: string,
	): Extract<ChatMessage, { role: "user" }> | null {
		const state = stateFor(sessionId);
		const idx = state.messages.findIndex(
			(m) => m.id === messageId && m.role === "user",
		);
		if (idx < 0) return null;
		const msg = state.messages[idx];
		if (msg.role !== "user") return null;
		commit({ pendingUserEdit: { sessionId, messageId } });
		return msg;
	}

	function cancelEditUser(): void {
		commit({ pendingUserEdit: null });
	}

	function isPendingEditMessage(sessionId: string, messageId: string): boolean {
		const p = get().pendingUserEdit;
		return Boolean(p && p.sessionId === sessionId && p.messageId === messageId);
	}

	/** True for the edited bubble and everything after it (dim while editing). */
	function isPendingEditTail(sessionId: string, messageId: string): boolean {
		const p = get().pendingUserEdit;
		if (!p || p.sessionId !== sessionId) return false;
		const state = stateFor(sessionId);
		const editIdx = state.messages.findIndex((m) => m.id === p.messageId);
		const msgIdx = state.messages.findIndex((m) => m.id === messageId);
		return editIdx >= 0 && msgIdx >= editIdx;
	}

	/** 运行中执行会截断会话的操作前先停下当前轮（abort 内部等 agent 退出）。 */
	async function stopRunBeforeMutation(
		sessionId: string,
		timeoutMs = 10_000,
	): Promise<void> {
		if (!stateFor(sessionId).running) return;
		await abort(sessionId);
		const deadline = Date.now() + timeoutMs;
		while (stateFor(sessionId).running && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}

	/** Regenerate from an assistant message by re-sending the preceding user prompt. */
	async function regenerate(
		sessionId: string,
		assistantMessageId: string,
	): Promise<void> {
		commit({ pendingUserEdit: null });
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
		// 运行中重新生成：先停下当前轮，避免两次生成互相抢会话树。
		await stopRunBeforeMutation(sessionId);
		setSessionState(
			sessionId,
			withRunClock({
				...stateFor(sessionId),
				messages: state.messages.slice(0, userIdx),
				streamingMessage: null,
				running: false,
				retryHint: null,
			}),
		);
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

	/** 按消息 id 定位用户气泡：消息下标 + 在用户消息中的轮次下标。 */
	function locateUserTurn(
		state: ChatState,
		messageId: string,
	): { cutIdx: number; userIndex: number; message: Extract<ChatMessage, { role: "user" }> } | null {
		let userIndex = -1;
		for (let i = 0; i < state.messages.length; i++) {
			const m = state.messages[i];
			if (!m || m.role !== "user") continue;
			userIndex += 1;
			if (m.id === messageId) return { cutIdx: i, userIndex, message: m };
		}
		return null;
	}

	/**
	 * 回退到某一轮结束：保留本轮问答，丢弃之后的全部轮次；文件保持现状。
	 * Agent 无法回退（越界或该下标已指向别的轮次）时不做任何改动，由调用方报错。
	 */
	async function restoreTurn(sessionId: string, messageId: string): Promise<{ ok: boolean }> {
		const located = locateUserTurn(stateFor(sessionId), messageId);
		if (!located) return { ok: false };
		let rolledBack = false;
		try {
			const result = await useSessionsStore.getState().sendCommand(sessionId, {
				type: "rollback_turn_end",
				userIndex: located.userIndex,
				expectText: located.message.text,
			});
			rolledBack = Boolean((result as { ok?: unknown } | null)?.ok);
		} catch {
			// 命令失败按回退失败处理
		}
		if (!rolledBack) return { ok: false };
		if (get().pendingUserEdit?.sessionId === sessionId) {
			commit({ pendingUserEdit: null });
		}
		// 被丢弃的轮次已消失，其 todo 不能继续留在界面上。
		useSessionWidgetsStore.getState().resetTodosForSession(sessionId);
		const state = stateFor(sessionId);
		const nextUserIdx = state.messages.findIndex(
			(m, i) => i > located.cutIdx && m.role === "user",
		);
		const endIdx = nextUserIdx === -1 ? state.messages.length : nextUserIdx;
		if (endIdx > located.cutIdx) {
			setSessionState(
				sessionId,
				withRunClock({
					...state,
					messages: state.messages.slice(0, endIdx),
					streamingMessage: null,
					running: false,
					retryHint: null,
				}),
			);
		}
		return { ok: true };
	}

	/** 把到某一轮为止的对话复制成新会话并切换过去；源会话保持完整。 */
	async function forkConversation(
		sessionId: string,
		messageId: string,
	): Promise<string | null> {
		const root = useWorkspaceStore.getState().root;
		const located = locateUserTurn(stateFor(sessionId), messageId);
		if (!root || !located) return null;
		const forked = await window.api.sessions.fork(
			sessionId,
			root,
			located.userIndex,
			located.message.text,
		);
		const sessions = useSessionsStore.getState();
		await sessions.refresh(root);
		beginHistoryLoad(forked.id);
		try {
			const [page] = await Promise.all([
				window.api.sessions.history(forked.filePath, {
					limit: SESSION_HISTORY_INITIAL_LIMIT,
				}),
				sessions.selectSession(forked.id, root),
			]);
			hydrateFromHistory(forked.id, page.messages, page.hasMore);
		} finally {
			endHistoryLoad(forked.id);
		}
		// 侧栏把新会话排到最前，否则它会落在「展开其余 N 个会话」折叠之下，看起来像没反应。
		window.dispatchEvent(
			new CustomEvent("pi-session-created", {
				detail: { root, sessionId: forked.id },
			}),
		);
		return forked.id;
	}

	/**
	 * Retry after an error bubble: keep prior user/assistant/tool history and continue.
	 * Does not wipe the failed turn's AI replies (unlike regenerate).
	 */
	async function retryFromError(
		sessionId: string,
		errorMessageId: string,
	): Promise<void> {
		commit({ pendingUserEdit: null });
		const state = stateFor(sessionId);
		const kept = dropErrorKeepHistory(state.messages, errorMessageId);
		if (!kept) return;
		const userMsg = findUserBeforeError(state.messages, errorMessageId);
		if (!userMsg) return;
		const continueTurn = turnHasProgressBeforeError(
			state.messages,
			errorMessageId,
		);

		softHangReported.delete(sessionId);
		setSessionState(
			sessionId,
			withRunClock({
				...state,
				messages: kept,
				streamingMessage: null,
				running: false,
				retryHint: null,
			}),
		);

		if (continueTurn) {
			// Resume-style: tell the agent to continue where it stopped WITHOUT
			// adding a "continue" user bubble to the transcript.
			setSessionState(
				sessionId,
				withRunClock(
					{
						...stateFor(sessionId),
						streamingMessage: null,
						running: true,
						retryHint: null,
						pendingAskUser: null,
					},
					{ activity: true },
				),
			);
			try {
				await useSessionsStore.getState().sendCommand(sessionId, {
					type: "prompt",
					message: t.retryContinueAgentPrompt,
				});
			} catch (err) {
				const raw = err instanceof Error ? err.message : String(err);
				setSessionState(
					sessionId,
					reduceChatEvent(stateFor(sessionId), {
						type: "prompt_error",
						sessionId,
						errorMessage: raw,
					}),
				);
			}
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
		useSessionWidgetsStore.getState().resetTodosForSession(sessionId);
		const images = userMsg.images?.map((img) => {
			const raw = img.dataUrl.replace(/^data:[^;]+;base64,/, "");
			return { type: "image" as const, data: raw, mimeType: img.mimeType };
		});
		const promptImages = toPromptImages(images);
		setSessionState(
			sessionId,
			withRunClock(
				{
					...stateFor(sessionId),
					running: true,
					streamingMessage: null,
					retryHint: null,
					nextToolOrder: 1,
					pendingAskUser: null,
				},
				{ activity: true },
			),
		);
		try {
			await useSessionsStore.getState().sendCommand(sessionId, {
				type: "prompt",
				message: userMsg.text,
				images: promptImages,
			});
		} catch (err) {
			const raw = err instanceof Error ? err.message : String(err);
			setSessionState(
				sessionId,
				reduceChatEvent(stateFor(sessionId), {
					type: "prompt_error",
					sessionId,
					errorMessage: raw,
				}),
			);
		}
	}

	return {
		...base,
		...derive(base),
		bindEvents,
		clearPendingAskUserFor,
		clearPendingPermissionFor,
		readAskDraft,
		writeAskDraft,
		readAskStep,
		writeAskStep,
		replyAskUser,
		replyPermission,
		replyExtensionUi,
		beginHistoryLoad,
		endHistoryLoad,
		hydrateFromHistory,
		loadOlderMessages,
		resyncActiveSession,
		clearSession,
		sendPrompt,
		steer,
		followUp,
		clearQueue,
		abort,
		truncateFrom,
		beginEditUser,
		cancelEditUser,
		isPendingEditMessage,
		isPendingEditTail,
		regenerate,
		retryFromError,
		restoreTurn,
		forkConversation,
		autoRecover,
	};
});

useSessionsStore.subscribe((state, prev) => {
	if (state.activeId === prev.activeId) return;
	useChatStore.setState((s) => derive(s));
});

import type { AgentEvent } from "../../../shared/protocol";
import type { AskUserPrompt } from "../../../shared/ask-user";
import type { PermissionAskPrompt } from "../../../shared/desktop-security";
import type { ExtensionUiPending } from "../../../shared/extension-ui";
import { formatLlmError } from "../utils/llm-error";
import { locale as uiLocalePref, t } from "../i18n";
import {
	isComposerAgentMode,
	stripComposerModePreamble,
} from "../../../shared/composer-modes";

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
			/** Inline tags (element / file path / url) shown in the bubble. */
			elementTags?: {
				url: string;
				host: string;
				label: string;
				content?: string;
				kind?: "file" | "url" | "element" | "agent" | "plan" | "ask" | "task";
			}[];
	  }
	| {
			id: string;
			role: "assistant";
			text: string;
			thinking?: string;
			streaming?: boolean;
			thinkingStartedAt?: number;
			thinkingDurationMs?: number;
			usage?: { input?: number; output?: number; totalTokens?: number } | null;
			durationMs?: number;
	  }
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
	| {
			id: string;
			role: "error";
			text: string;
			variant?: "error" | "cancelled";
	  };

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
	/** Wall-clock when the current turn became running (ms). */
	turnStartedAt: number | null;
	/**
	 * Wall-clock when the current wait phase began (ms).
	 * Resets on phase changes (waiting_model → thinking → tool → …);
	 * turnStartedAt keeps the whole-turn total for the header.
	 */
	phaseStartedAt: number | null;
	/** Last agent stream / tool / status activity (ms). */
	lastActivityAt: number | null;
	/** Last worker heartbeat pong while a turn is active (ms). */
	lastWorkerAliveAt: number | null;
	/** Consecutive auto-recover attempts since last successful turn. */
	autoRecoverCount: number;
	/** True while restart + resend is in flight. */
	autoRecovering: boolean;
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
		turnStartedAt: null,
		phaseStartedAt: null,
		lastActivityAt: null,
		lastWorkerAliveAt: null,
		autoRecoverCount: 0,
		autoRecovering: false,
	};
}

/**
 * Cap streamed tool output (bash etc.) so repeated tool_execution_update
 * events never re-parse an unbounded accumulator on the UI thread. The
 * final tool_execution_end still carries the complete result, and the card
 * preview only shows ~24 lines regardless.
 */
const STREAM_RESULT_CAP_CHARS = 48 * 1024;

export function capStreamedToolResult(result: unknown): unknown {
	if (typeof result !== "string" || result.length <= STREAM_RESULT_CAP_CHARS)
		return result;
	return `\u2026 (output truncated for display)\n${result.slice(-STREAM_RESULT_CAP_CHARS)}`;
}

/** Keep / clear turn clocks after a reducer step. */
export function withRunClock(
	state: ChatState,
	opts?: { activity?: boolean; workerAlive?: boolean; now?: number },
): ChatState {
	if (!state.running) {
		if (
			state.turnStartedAt == null &&
			state.phaseStartedAt == null &&
			state.lastActivityAt == null &&
			state.lastWorkerAliveAt == null
		) {
			return state;
		}
		return {
			...state,
			turnStartedAt: null,
			phaseStartedAt: null,
			lastActivityAt: null,
			lastWorkerAliveAt: null,
		};
	}
	const now = opts?.now ?? Date.now();
	return {
		...state,
		turnStartedAt: state.turnStartedAt ?? now,
		phaseStartedAt: state.phaseStartedAt ?? now,
		lastActivityAt:
			opts?.activity === false ? (state.lastActivityAt ?? now) : now,
		lastWorkerAliveAt: opts?.workerAlive ? now : state.lastWorkerAliveAt,
	};
}

/** True when a session still has a live in-memory turn the disk page cannot represent. */
export function hasLiveTurnState(state: ChatState): boolean {
	return (
		state.running ||
		state.autoRecovering ||
		state.streamingMessage != null ||
		state.pendingAskUser != null ||
		state.pendingPermission != null ||
		state.pendingExtensionUi != null
	);
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
			return Boolean(
				part &&
					typeof part === "object" &&
					(part as { type?: string }).type === "text",
			);
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

/**
 * Streaming text/thinking must not shrink mid-turn.
 * Some model/SDK updates replace the thinking part with a short section title
 * (e.g. "**Adjusting proxy configuration**") after longer content already arrived.
 */
export function coalesceGrowingText(
	snapshot: string,
	previous: string,
): string {
	if (!snapshot) return previous;
	if (!previous) return snapshot;
	if (snapshot.length >= previous.length) return snapshot;
	return previous;
}

/** Extract {input, output, totalTokens} from an assistant message's usage. */
function parseMessageUsage(message: Record<string, unknown>): {
	input?: number;
	output?: number;
	totalTokens?: number;
} | null {
	const usage = message.usage;
	if (!usage || typeof usage !== "object") return null;
	const u = usage as Record<string, unknown>;
	const num = (v: unknown): number | undefined =>
		typeof v === "number" && Number.isFinite(v) ? v : undefined;
	const input = num(u.input);
	const output = num(u.output);
	const total = num(u.totalTokens) ?? num(u.total);
	if (input == null && output == null && total == null) return null;
	return {
		...(input != null ? { input } : {}),
		...(output != null ? { output } : {}),
		...(total != null ? { totalTokens: total } : {}),
	};
}

/**
 * Per-turn wall-clock duration (ms). Uses the turn clock stamped when the
 * turn started (turn_started_at); falls back to the thinking clock when the
 * turn clock is unavailable (e.g. history replay).
 */
function usageDurationMs(
	state: ChatState,
	thinkingDurationMs: number | undefined,
): number | null {
	if (state.turnStartedAt != null && Number.isFinite(state.turnStartedAt)) {
		const dur = Date.now() - state.turnStartedAt;
		if (dur > 0) return dur;
	}
	return thinkingDurationMs != null ? thinkingDurationMs : null;
}

type ExtractedToolCall = {
	id: string;
	name: string;
	arguments: unknown;
};

/** Tool calls embedded in a streaming assistant message (partial args grow via toolcall_delta). */
function toolCallsFromMessage(
	message: Record<string, unknown>,
): ExtractedToolCall[] {
	const content = message.content;
	if (!Array.isArray(content)) return [];
	const out: ExtractedToolCall[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const p = part as Record<string, unknown>;
		if (p.type !== "toolCall" && p.type !== "tool_use") continue;
		const id = typeof p.id === "string" ? p.id : "";
		if (!id) continue;
		const name =
			typeof p.name === "string" && p.name
				? p.name
				: typeof p.toolName === "string" && p.toolName
					? p.toolName
					: "tool";
		const args =
			p.arguments !== undefined
				? p.arguments
				: p.input !== undefined
					? p.input
					: {};
		out.push({ id, name, arguments: args });
	}
	return out;
}

/**
 * Keep the currently-live tool card visible when a newer tool takes over the
 * live slot. Moving it into history (instead of overwriting) means parallel
 * edit/write/bash calls each show their own card instead of one box that
 * directly switches to the next file.
 */
function parkLiveTool(
	messages: ChatMessage[],
	streaming: ChatState["streamingMessage"],
): ChatMessage[] {
	if (streaming?.role !== "tool") return messages;
	if (messages.some((m) => m.id === streaming.id)) return messages;
	return [...messages, { ...streaming, streaming: true }];
}

function commitAssistantStream(state: ChatState): ChatState {
	const stream = state.streamingMessage;
	if (stream?.role !== "assistant") return state;
	if (!stream.text && !stream.thinking) {
		return { ...state, streamingMessage: null };
	}
	return upsertAssistantMessage(state, { ...stream, streaming: false });
}

/**
 * Insert or replace an assistant row. Same SDK message id (or identical text+thinking
 * after the last user bubble) must never create a second bubble — tool loops used to
 * re-commit the same assistant on every toolcall_delta / message_end.
 */
function upsertAssistantMessage(
	state: ChatState,
	assistant: Extract<ChatMessage, { role: "assistant" }>,
): ChatState {
	const finalized: Extract<ChatMessage, { role: "assistant" }> =
		stampThinkingClock(
			{
				...assistant,
				streaming: false,
			},
			{ finalize: true },
		);

	const byId = state.messages.findIndex(
		(m) => m.role === "assistant" && m.id === finalized.id,
	);
	if (byId >= 0) {
		const messages = state.messages.slice();
		messages[byId] = finalized;
		return { ...state, messages, streamingMessage: null };
	}

	// Unstable ids: collapse identical content since the last user message.
	let from = 0;
	for (let i = state.messages.length - 1; i >= 0; i--) {
		if (state.messages[i]?.role === "user") {
			from = i + 1;
			break;
		}
	}
	for (let i = from; i < state.messages.length; i++) {
		const m = state.messages[i];
		if (m?.role !== "assistant") continue;
		if (
			m.text === finalized.text &&
			(m.thinking ?? "") === (finalized.thinking ?? "")
		) {
			const messages = state.messages.slice();
			messages[i] = { ...finalized, id: m.id };
			return { ...state, messages, streamingMessage: null };
		}
	}

	return {
		...state,
		messages: [...state.messages, finalized],
		streamingMessage: null,
	};
}

/**
 * Mirror partial toolCall.* from the assistant message into live tool cards so
 * write/edit content streams like thinking (not only after tool_execution_end).
 *
 * Important: park the in-flight assistant bubble at most once. Rebuilding it from
 * the partial message on every toolcall_delta re-appends duplicates in the UI.
 */
function syncStreamingToolCalls(
	state: ChatState,
	message: Record<string, unknown>,
): ChatState {
	const calls = toolCallsFromMessage(message);
	if (!calls.length) return state;

	let next = state;
	if (state.streamingMessage?.role === "assistant") {
		// Refresh once from the latest partial, then move it into history so the
		// live slot can become the tool card.
		next = commitAssistantStream({
			...state,
			streamingMessage: assistantFromPartial(message, state.streamingMessage),
		});
	} else if (!state.streamingMessage) {
		// Toolcalls arrived with no live assistant stream — park text/thinking once
		// (upsert) if missing from history for this turn.
		const text = textFromMessage(message);
		const thinking = thinkingFromMessage(message);
		if (text || thinking) {
			const draft = assistantFromPartial(message, null);
			next = upsertAssistantMessage(state, { ...draft, streaming: false });
		}
	}
	// If streamingMessage is already a tool (or assistant already parked), only
	// update tool cards — never re-materialize an assistant bubble.

	let messages = next.messages;
	let streaming = next.streamingMessage;
	let order = next.nextToolOrder;

	for (let i = 0; i < calls.length; i++) {
		const tc = calls[i]!;
		const id = `tool-${tc.id}`;
		const isLast = i === calls.length - 1;
		const existingIdx = messages.findIndex((m) => m.id === id);
		const existingInList =
			existingIdx >= 0 && messages[existingIdx]?.role === "tool"
				? (messages[existingIdx] as Extract<ChatMessage, { role: "tool" }>)
				: null;

		// Already finalized with a result — leave alone.
		if (
			existingInList &&
			!existingInList.streaming &&
			existingInList.result !== undefined
		) {
			continue;
		}

		const baseOrder =
			existingInList?.order ??
			(streaming?.role === "tool" && streaming.id === id
				? streaming.order
				: undefined);
		const toolMsg: Extract<ChatMessage, { role: "tool" }> = {
			id,
			role: "tool",
			toolCallId: tc.id,
			toolName: tc.name,
			args: tc.arguments,
			streaming: true,
			order: baseOrder ?? order++,
			...(existingInList?.result !== undefined
				? { result: existingInList.result }
				: {}),
			...(existingInList?.isError !== undefined
				? { isError: existingInList.isError }
				: {}),
		};

		if (existingInList) {
			messages = messages.slice();
			messages[existingIdx] = toolMsg;
			if (streaming?.role === "tool" && streaming.id === id) {
				streaming = toolMsg;
			}
			continue;
		}

		if (streaming?.role === "tool" && streaming.id === id) {
			streaming = toolMsg;
			continue;
		}

		if (isLast) {
			if (streaming?.role === "tool" && streaming.id !== id) {
				// Park the previous live tool into history so the newest stays in streamingMessage.
				const parked = messages.find((m) => m.id === streaming!.id);
				if (!parked) {
					messages = [...messages, { ...streaming, streaming: true }];
				}
			}
			streaming = toolMsg;
		} else {
			messages = [...messages, toolMsg];
		}
	}

	return {
		...next,
		messages,
		streamingMessage: streaming,
		nextToolOrder: order,
		running: true,
	};
}

function imagesFromMessage(
	message: Record<string, unknown>,
): ChatUserImage[] | undefined {
	const content = message.content;
	if (!Array.isArray(content)) return undefined;
	const images: ChatUserImage[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const p = part as Record<string, unknown>;
		if (p.type !== "image") continue;
		const mimeType =
			typeof p.mimeType === "string" && p.mimeType ? p.mimeType : "image/png";
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
): Extract<ChatMessage, { role: "assistant" }> {
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
	const prevStarted =
		prev?.role === "assistant" ? prev.thinkingStartedAt : undefined;
	const prevDuration =
		prev?.role === "assistant" ? prev.thinkingDurationMs : undefined;
	const text = coalesceGrowingText(snapshot, prevText);
	const thinking = coalesceGrowingText(thinkingSnap, prevThinking);
	return stampThinkingClock({
		id,
		role: "assistant",
		text,
		...(thinking ? { thinking } : {}),
		...(prevStarted != null ? { thinkingStartedAt: prevStarted } : {}),
		...(prevDuration != null ? { thinkingDurationMs: prevDuration } : {}),
		streaming: true,
	});
}

/** Start / freeze thinking elapsed time on assistant bubbles. */
export function stampThinkingClock(
	msg: Extract<ChatMessage, { role: "assistant" }>,
	opts: { now?: number; finalize?: boolean } = {},
): Extract<ChatMessage, { role: "assistant" }> {
	const now = opts.now ?? Date.now();
	const hasThinkingText = Boolean(msg.thinking?.trim());
	const thinkingInFlight = Boolean(msg.streaming) && !msg.text?.trim();
	let thinkingStartedAt = msg.thinkingStartedAt;
	let thinkingDurationMs = msg.thinkingDurationMs;

	if (
		(hasThinkingText || thinkingInFlight) &&
		thinkingStartedAt == null &&
		thinkingDurationMs == null
	) {
		thinkingStartedAt = now;
	}

	const shouldFinalize =
		Boolean(opts.finalize) ||
		(Boolean(msg.text?.trim()) && thinkingStartedAt != null) ||
		(!msg.streaming && thinkingStartedAt != null && hasThinkingText);

	if (shouldFinalize && thinkingStartedAt != null) {
		thinkingDurationMs = Math.max(
			thinkingDurationMs ?? 0,
			Math.max(0, now - thinkingStartedAt),
		);
		thinkingStartedAt = undefined;
	}

	const next: Extract<ChatMessage, { role: "assistant" }> = {
		id: msg.id,
		role: "assistant",
		text: msg.text,
		streaming: msg.streaming,
	};
	if (msg.thinking) next.thinking = msg.thinking;
	if (thinkingStartedAt != null) next.thinkingStartedAt = thinkingStartedAt;
	if (thinkingDurationMs != null) next.thinkingDurationMs = thinkingDurationMs;
	if (msg.usage != null) next.usage = msg.usage;
	if (msg.durationMs != null) next.durationMs = msg.durationMs;
	return next;
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

/** Flush in-flight assistant/tool bubble into history so abort doesn't wipe it. */
function commitStreamingMessage(state: ChatState): ChatState {
	const stream = state.streamingMessage;
	if (!stream) return state;
	if (stream.role === "assistant") {
		if (!stream.text && !stream.thinking) {
			return { ...state, streamingMessage: null };
		}
		return upsertAssistantMessage(state, { ...stream, streaming: false });
	}
	if (stream.role === "tool") {
		return {
			...state,
			streamingMessage: null,
			messages: [...state.messages, { ...stream, streaming: false }],
		};
	}
	return { ...state, streamingMessage: null };
}

function errorVariant(
	text: string,
	explicit?: "error" | "cancelled",
): "error" | "cancelled" {
	if (explicit) return explicit;
	if (
		/已取消|已停止|cancelled|canceled|aborted|generation stopped/i.test(text)
	) {
		return "cancelled";
	}
	return "error";
}

function appendError(
	state: ChatState,
	text: string,
	opts?: { variant?: "error" | "cancelled" },
): ChatState {
	const committed = commitStreamingMessage(state);
	const trimmed = friendlyError(text).trim();
	if (!trimmed) {
		return {
			...committed,
			running: false,
			streamingMessage: null,
			retryHint: null,
		};
	}
	const variant = errorVariant(trimmed, opts?.variant);
	const last = committed.messages.at(-1);
	if (last?.role === "error" && last.text === trimmed) {
		return {
			...committed,
			running: false,
			streamingMessage: null,
			retryHint: null,
		};
	}
	return {
		...committed,
		running: false,
		streamingMessage: null,
		retryHint: null,
		messages: [
			...committed.messages,
			{ id: localId("error"), role: "error", text: trimmed, variant },
		],
	};
}

function reduceAgentPayload(
	state: ChatState,
	payload: Record<string, unknown>,
): ChatState {
	const type = payload.type;
	if (type === "agent_start" || type === "turn_start") {
		return { ...state, running: true, streamingMessage: null, retryHint: null };
	}
	if (type === "auto_retry_start") {
		const attempt = typeof payload.attempt === "number" ? payload.attempt : 1;
		const maxAttempts =
			typeof payload.maxAttempts === "number" ? payload.maxAttempts : attempt;
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
	if (
		type === "compaction_end" &&
		typeof payload.errorMessage === "string" &&
		payload.errorMessage
	) {
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

		// Progressive toolCall args (write/edit content) — stream into tool cards.
		const toolCalls = toolCallsFromMessage(msg);
		if (toolCalls.length > 0) {
			return syncStreamingToolCalls(state, msg);
		}

		// Mid tool-loop: keep the live tool card; do not resurrect an assistant bubble
		// from a text/thinking snapshot (that re-commits on the next toolcall_delta).
		if (state.streamingMessage?.role === "tool") {
			return { ...state, running: true };
		}

		const msgId = typeof msg.id === "string" ? msg.id : "";
		const existingAssistantIdx = msgId
			? state.messages.findIndex((m) => m.role === "assistant" && m.id === msgId)
			: -1;
		if (existingAssistantIdx >= 0) {
			// Already parked for this turn (tools in progress). Refresh in place only.
			const prev = state.messages[existingAssistantIdx] as Extract<
				ChatMessage,
				{ role: "assistant" }
			>;
			const refreshed = assistantFromPartial(msg, prev);
			const messages = state.messages.slice();
			messages[existingAssistantIdx] = stampThinkingClock(
				{ ...refreshed, streaming: false },
				{ finalize: true },
			);
			return { ...state, running: true, messages };
		}

		let nextStream = assistantFromPartial(msg, state.streamingMessage);

		const assistantEvent = payload.assistantMessageEvent;
		if (assistantEvent && typeof assistantEvent === "object") {
			const ev = assistantEvent as Record<string, unknown>;
			if (ev.type === "text_delta" && typeof ev.delta === "string") {
				const snapshot = textFromMessage(msg);
				if (!snapshot) {
					nextStream = stampThinkingClock({
						...nextStream,
						text: nextStream.text + ev.delta,
					});
				}
			}
			if (ev.type === "thinking_delta" && typeof ev.delta === "string") {
				const snap = thinkingFromMessage(msg);
				const current = nextStream.thinking ?? "";
				// Prefer growing snapshot; only append delta when snapshot is empty/stale.
				if (snap && snap.length >= current.length) {
					nextStream = stampThinkingClock({
						...nextStream,
						thinking: snap,
					});
				} else if (ev.delta) {
					nextStream = stampThinkingClock({
						...nextStream,
						thinking: current + ev.delta,
					});
				}
			}
			if (
				ev.type === "thinking_end" &&
				typeof ev.content === "string" &&
				ev.content
			) {
				nextStream = stampThinkingClock(
					{
						...nextStream,
						// Never replace a long stream with a short "section title" end payload.
						thinking: coalesceGrowingText(ev.content, nextStream.thinking ?? ""),
					},
					{ finalize: true },
				);
			}
			if (
				ev.type === "toolcall_start" ||
				ev.type === "toolcall_delta" ||
				ev.type === "toolcall_end"
			) {
				// Prefer the partial AssistantMessage on the event when present.
				const partial =
					ev.partial && typeof ev.partial === "object"
						? (ev.partial as Record<string, unknown>)
						: msg;
				return syncStreamingToolCalls(state, partial);
			}
			if (ev.type === "error" && typeof ev.error === "object" && ev.error) {
				const errObj = ev.error as Record<string, unknown>;
				const msgText =
					typeof errObj.message === "string"
						? errObj.message
						: typeof ev.message === "string"
							? ev.message
							: "Request failed";
				return appendError({ ...state, streamingMessage: nextStream }, msgText);
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
			const rawText = textFromMessage(msg);
			const text = stripComposerModePreamble(rawText);
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
					/Context from browser selection:|### Citation\s+\d+/i.test(rawText) &&
					(!last.text.trim() ||
						rawText.trim().endsWith(last.text.trim()) ||
						rawText.includes(last.text.trim()));
				// Mode preamble is for the model only — keep the short optimistic bubble.
				const modePreambleEcho =
					rawText !== text &&
					Boolean(last.text.trim()) &&
					(text.trim() === last.text.trim() || rawText.includes(last.text.trim()));
				// File/URL chips are path/url *text* for the agent (`@path` / raw url). The bubble
				// keeps structured tags — never mirror the expanded prompt as another user row.
				if (
					sameText ||
					expandedCitationEcho ||
					modePreambleEcho ||
					hasLocalExtras
				) {
					const next = [...state.messages];
					next[next.length - 1] = {
						id,
						role: "user",
						text: last.text,
						images: last.images ?? fromEvent,
						elementTags: last.elementTags?.filter(
							(tag) =>
								tag.kind !== "agent" &&
								tag.kind !== "ask" &&
								tag.kind !== "plan" &&
								tag.kind !== "task",
						),
					};
					return { ...state, messages: next, streamingMessage: null };
				}
			}
			if (state.messages.some((m) => m.id === id)) {
				return { ...state, streamingMessage: null };
			}
			// Never surface agent-side citation dumps as user bubbles
			if (/Context from browser selection:|### Citation\s+\d+/i.test(rawText)) {
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
			const stop = msg.stopReason;
			const isAborted = stop === "aborted";
			const errText = sdkErrorText(msg);
			const snapshot = textFromMessage(msg);
			const thinkingSnap = thinkingFromMessage(msg);
			const stream = state.streamingMessage;
			const id =
				typeof msg.id === "string" && msg.id
					? msg.id
					: stream?.role === "assistant"
						? stream.id
						: localId("assistant");
			const text = coalesceGrowingText(
				snapshot,
				stream?.role === "assistant" ? stream.text : "",
			);
			const thinking =
				coalesceGrowingText(
					thinkingSnap,
					stream?.role === "assistant" ? (stream.thinking ?? "") : "",
				) || undefined;

			// Always keep partial thinking/answer on abort (and on mid-stream errors).
			let next: ChatState = { ...state, streamingMessage: null };
			if (text || thinking) {
				const started =
					stream?.role === "assistant" ? stream.thinkingStartedAt : undefined;
				const duration =
					stream?.role === "assistant" ? stream.thinkingDurationMs : undefined;
				const usage = parseMessageUsage(msg);
				const dur = usageDurationMs(state, duration);
				next = upsertAssistantMessage(next, {
					id,
					role: "assistant",
					text,
					...(thinking ? { thinking } : {}),
					...(started != null ? { thinkingStartedAt: started } : {}),
					...(duration != null ? { thinkingDurationMs: duration } : {}),
					...(usage ? { usage } : {}),
					...(dur != null ? { durationMs: dur } : {}),
					streaming: false,
				});
			}

			if (errText) {
				return appendError(next, errText, {
					variant: isAborted ? "cancelled" : "error",
				});
			}
			return next;
		}
		return { ...state, streamingMessage: null };
	}
	if (type === "turn_end") {
		const message = payload.message;
		if (message && typeof message === "object") {
			const msg = message as Record<string, unknown>;
			const errText = sdkErrorText(msg);
			if (errText) {
				return appendError(state, errText, {
					variant: msg.stopReason === "aborted" ? "cancelled" : "error",
				});
			}
		}
		return state;
	}
	if (type === "tool_execution_start") {
		const toolCallId = String(payload.toolCallId ?? localId("tool"));
		const id = `tool-${toolCallId}`;
		// Finalize any in-progress assistant text/thinking into history first
		let next = commitAssistantStream(state);
		let messages = next.messages;
		const toolName = String(payload.toolName ?? "tool");
		const args = payload.args;

		// Prefer updating an already-streaming tool card (from toolcall_delta).
		if (
			next.streamingMessage?.role === "tool" &&
			next.streamingMessage.id === id
		) {
			return {
				...next,
				running: true,
				streamingMessage: {
					...next.streamingMessage,
					toolName,
					args: args ?? next.streamingMessage.args,
					streaming: true,
				},
			};
		}
		const existingIdx = messages.findIndex((m) => m.id === id);
		if (existingIdx >= 0 && messages[existingIdx]?.role === "tool") {
			const existing = messages[existingIdx] as Extract<
				ChatMessage,
				{ role: "tool" }
			>;
			const updated: Extract<ChatMessage, { role: "tool" }> = {
				...existing,
				toolName,
				args: args ?? existing.args,
				streaming: true,
			};
			// Promote to streamingMessage for live follow-bottom, but keep any other
			// currently-live tool card visible instead of dropping it.
			messages = parkLiveTool(
				messages.filter((_, i) => i !== existingIdx),
				next.streamingMessage,
			);
			return {
				...next,
				running: true,
				messages,
				streamingMessage: updated,
			};
		}

		const order = next.nextToolOrder;
		messages = parkLiveTool(messages, next.streamingMessage);
		return {
			...next,
			running: true,
			messages,
			nextToolOrder: order + 1,
			streamingMessage: {
				id,
				role: "tool",
				toolCallId,
				toolName,
				args,
				streaming: true,
				order,
			},
		};
	}
	if (type === "tool_execution_update") {
		const toolCallId = String(payload.toolCallId ?? "");
		const id = `tool-${toolCallId}`;
		const toolName = String(payload.toolName ?? "tool");
		const patch = (
			msg: Extract<ChatMessage, { role: "tool" }>,
		): Extract<ChatMessage, { role: "tool" }> => ({
			...msg,
			toolName: toolName || msg.toolName,
			args: payload.args ?? msg.args,
			// Progressive tool output (bash etc.); write/edit usually update via args.
			result: capStreamedToolResult(payload.partialResult ?? msg.result),
			streaming: true,
		});

		if (
			state.streamingMessage?.role === "tool" &&
			state.streamingMessage.id === id
		) {
			return {
				...state,
				running: true,
				streamingMessage: patch(state.streamingMessage),
			};
		}
		const idx = state.messages.findIndex((m) => m.id === id);
		if (idx >= 0 && state.messages[idx]?.role === "tool") {
			const next = state.messages.slice();
			next[idx] = patch(
				state.messages[idx] as Extract<ChatMessage, { role: "tool" }>,
			);
			return { ...state, running: true, messages: next };
		}
		// Late update without start — create a streaming card.
		const order = state.nextToolOrder;
		const parked = parkLiveTool(state.messages, state.streamingMessage);
		return {
			...state,
			running: true,
			nextToolOrder: order + 1,
			messages: parked,
			streamingMessage: {
				id,
				role: "tool",
				toolCallId,
				toolName,
				args: payload.args,
				result: capStreamedToolResult(payload.partialResult),
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
		const prior = stream ?? (existing?.role === "tool" ? existing : null);
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
		// The finished tool is the live card: finalize it into history.
		if (stream) {
			return {
				...state,
				messages: [...state.messages, toolMsg],
				streamingMessage: null,
			};
		}
		// Otherwise just update/append the finished tool. A different tool may
		// still be streaming in the live slot — keep it visible instead of
		// nulling streamingMessage (that used to drop the other card).
		const idx = state.messages.findIndex((m) => m.id === id);
		if (idx >= 0) {
			const next = [...state.messages];
			next[idx] = toolMsg;
			return { ...state, messages: next };
		}
		return {
			...state,
			messages: [...state.messages, toolMsg],
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
				const msg = last as Record<string, unknown>;
				const errText = sdkErrorText(msg);
				if (errText) {
					return appendError(state, errText, {
						variant: msg.stopReason === "aborted" ? "cancelled" : "error",
					});
				}
			}
		}
		// Keep UI in sync when the agent loop finished — do not wait for prompt_done
		// (session.prompt() can lag or stall after agent_end; sessions store already goes idle).
		const committed = commitStreamingMessage(state);
		return {
			...committed,
			running: false,
			retryHint: null,
			nextToolOrder: 1,
			// Never leave parked tool/assistant cards flagged "streaming" after the
			// round ends — the UI folds them once nothing is live anymore.
			messages: committed.messages.map((m) =>
				m.role === "tool" || m.role === "assistant"
					? { ...m, streaming: false }
					: m,
			),
		};
	}
	if (type === "agent_settled") {
		// Fallback idle if prompt_done was missed; normally agent_end / prompt_done clears running.
		const committed = commitStreamingMessage(state);
		return {
			...committed,
			running: false,
			retryHint: null,
			nextToolOrder: 1,
		};
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
	const trimmed = stripComposerModePreamble(text).trim();
	const visibleTags = elementTags?.filter(
		(tag) => !isComposerAgentMode(tag.kind),
	);
	const hasImages = Boolean(images?.length);
	const hasTags = Boolean(visibleTags?.length);
	if (!trimmed && !hasImages && !hasTags) {
		return state;
	}
	return withRunClock(
		{
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
					elementTags: hasTags ? visibleTags : undefined,
				},
			],
		},
		{ activity: true },
	);
}

export function reduceChatEvent(
	state: ChatState,
	event: AgentEvent,
): ChatState {
	switch (event.type) {
		case "connected":
			return state;
		case "agent_event": {
			const payload =
				event.event && typeof event.event === "object"
					? (event.event as Record<string, unknown>)
					: {};
			const next = reduceAgentPayload(state, payload);
			const t = payload.type;
			// Start a turn only on lifecycle starts. Late stream/tool chunks after
			// prompt_done / agent_end must not resurrect running (sticky "运行中").
			const isLifecycleStart =
				t === "agent_start" || t === "turn_start" || t === "auto_retry_start";
			if (!state.running && !isLifecycleStart && next.running) {
				return withRunClock({ ...next, running: false }, { activity: true });
			}
			return withRunClock(next, { activity: true });
		}
		case "prompt_done": {
			const committed = commitStreamingMessage(state);
			return withRunClock({
				...committed,
				running: false,
				retryHint: null,
				messages: committed.messages.map((m) =>
					m.role === "assistant" || m.role === "tool"
						? { ...m, streaming: false }
						: m,
				),
			});
		}
		case "prompt_error":
			return withRunClock(appendError(state, event.errorMessage));
		case "worker_stuck":
			// Surface in this session's chat (not only the sidebar banner).
			return withRunClock(appendError(state, t.stuckBanner));
		case "worker_alive":
			return withRunClock(state, { activity: false, workerAlive: true });
		case "worker_stall":
			// Renderer watchdog owns stall recovery (autoRecover) — keep turn running.
			return state;
		case "worker_exit":
			// Non-zero / unexpected exit → show in chat; clean idle-destroy (0/null) is silent.
			if (event.code !== 0 && event.code != null) {
				return withRunClock(
					appendError(
						state,
						uiLocale() === "zh-CN"
							? `会话 Worker 异常退出（code ${event.code}）。可终止或重启此会话。`
							: `Session worker exited unexpectedly (code ${event.code}). Terminate or restart this session.`,
					),
				);
			}
			return withRunClock({
				...state,
				running: false,
				streamingMessage: null,
				retryHint: null,
			});
		case "session_status":
			if (event.status === "running") {
				return withRunClock({ ...state, running: true }, { activity: true });
			}
			// idle | error | stuck → not actively generating
			return withRunClock({
				...state,
				running: false,
				streamingMessage: null,
				retryHint: null,
			});
		case "context_usage":
			return state;
		default: {
			const _never: never = event;
			void _never;
			return state;
		}
	}
}

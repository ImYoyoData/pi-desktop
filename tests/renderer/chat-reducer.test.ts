import { describe, expect, it } from "vitest";
import { ASK_USER_TOOL_NAME } from "../../src/shared/ask-user";
import {
	appendUserMessage,
	clearPendingAskUser,
	createChatState,
	hasLiveTurnState,
	reduceChatEvent,
	setPendingAskUser,
	type ChatState,
} from "../../src/renderer/src/stores/chat-reducer";

describe("reduceChatEvent", () => {
	it("appends a user message", () => {
		let state = createChatState();
		state = appendUserMessage(state, "hello");
		expect(state.messages).toHaveLength(1);
		expect(state.messages[0]).toMatchObject({ role: "user", text: "hello" });
	});

	it("appends user images for chat bubble display", () => {
		let state = createChatState();
		state = appendUserMessage(state, " ", [
			{ mimeType: "image/png", dataUrl: "data:image/png;base64,abc" },
		]);
		expect(state.messages[0]).toMatchObject({
			role: "user",
			text: "",
			images: [{ mimeType: "image/png", dataUrl: "data:image/png;base64,abc" }],
		});
	});

	it("keeps element tags on user message", () => {
		let state = createChatState();
		state = appendUserMessage(state, "这个是？", undefined, [
			{
				url: "https://www.baidu.com/",
				host: "www.baidu.com",
				label: "#s-hotsearch-wrapper",
			},
		]);
		expect(state.messages[0]).toMatchObject({
			role: "user",
			text: "这个是？",
			elementTags: [{ host: "www.baidu.com", label: "#s-hotsearch-wrapper" }],
		});
	});

	it("does not duplicate user bubble when agent echoes citation dump", () => {
		let state = createChatState();
		state = appendUserMessage(state, "这个是？", undefined, [
			{ url: "https://www.baidu.com/", host: "www.baidu.com", label: "#x" },
		]);
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s",
			event: {
				type: "message_end",
				message: {
					role: "user",
					content: [
						{
							type: "text",
							text:
								"Context from browser selection:\n\n### Citation 1\n- URL: https://www.baidu.com/\n\n---\n\n这个是？",
						},
					],
				},
			},
		});
		expect(state.messages).toHaveLength(1);
		expect(state.messages[0]).toMatchObject({ role: "user", text: "这个是？" });
	});

	it("does not mirror @path chip expansion as a second user bubble", () => {
		let state = createChatState();
		state = appendUserMessage(state, "删除", undefined, [
			{
				url: "txt",
				host: "",
				label: "txt",
				content: "txt",
				kind: "file",
			},
		]);
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s",
			event: {
				type: "message_end",
				message: {
					role: "user",
					content: [{ type: "text", text: "删除\n\n@txt" }],
				},
			},
		});
		expect(state.messages).toHaveLength(1);
		expect(state.messages[0]).toMatchObject({
			role: "user",
			text: "删除",
			elementTags: [{ kind: "file", content: "txt" }],
		});
	});

	it("keeps a single streaming bubble replaced on message_update (pi-web style)", () => {
		let state = createChatState();
		const sessionId = "sess-1";
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId,
			event: {
				type: "message_start",
				message: {
					role: "assistant",
					id: "asst-1",
					content: [{ type: "text", text: "" }],
				},
			},
		});
		expect(state.messages).toHaveLength(0);
		expect(state.streamingMessage).toMatchObject({
			role: "assistant",
			id: "asst-1",
			streaming: true,
		});

		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId,
			event: {
				type: "message_update",
				message: {
					role: "assistant",
					id: "asst-1",
					content: [{ type: "text", text: "Hel" }],
				},
			},
		});
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId,
			event: {
				type: "message_update",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Hello" }],
				},
			},
		});
		expect(state.messages).toHaveLength(0);
		expect(state.streamingMessage).toMatchObject({
			role: "assistant",
			text: "Hello",
			streaming: true,
		});

		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId,
			event: {
				type: "message_end",
				message: {
					role: "assistant",
					id: "asst-1",
					content: [{ type: "text", text: "Hello" }],
				},
			},
		});
		expect(state.streamingMessage).toBeNull();
		expect(state.messages).toHaveLength(1);
		expect(state.messages[0]).toMatchObject({
			role: "assistant",
			text: "Hello",
			streaming: false,
		});
	});

	it("appends via text_delta when snapshot empty", () => {
		let state = createChatState();
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s",
			event: {
				type: "message_start",
				message: { role: "assistant", content: [{ type: "text", text: "" }] },
			},
		});
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s",
			event: {
				type: "message_update",
				message: { role: "assistant", content: [{ type: "text", text: "" }] },
				assistantMessageEvent: { type: "text_delta", delta: "你" },
			},
		});
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s",
			event: {
				type: "message_update",
				message: { role: "assistant", content: [{ type: "text", text: "" }] },
				assistantMessageEvent: { type: "text_delta", delta: "好" },
			},
		});
		expect(state.messages).toHaveLength(0);
		expect(state.streamingMessage).toMatchObject({ text: "你好" });
	});

	it("upserts tool call rows", () => {
		let state = createChatState();
		const sessionId = "sess-1";
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId,
			event: {
				type: "tool_execution_start",
				toolCallId: "tc-1",
				toolName: "read",
				args: { path: "foo.txt" },
			},
		});
		expect(state.streamingMessage).toMatchObject({
			role: "tool",
			toolCallId: "tc-1",
			toolName: "read",
			streaming: true,
		});
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId,
			event: {
				type: "tool_execution_end",
				toolCallId: "tc-1",
				toolName: "read",
				result: { ok: true },
				isError: false,
			},
		});
		expect(state.streamingMessage).toBeNull();
		expect(state.messages[0]).toMatchObject({
			streaming: false,
			result: { ok: true },
			isError: false,
		});
	});

	it("clears running on agent_end when not retrying", () => {
		let state = createChatState();
		state = { ...state, running: true };
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s",
			event: { type: "agent_end", willRetry: false },
		});
		expect(state.running).toBe(false);
	});

	it("does not resurrect running from late stream events after idle", () => {
		let state = createChatState();
		state = { ...state, running: true };
		state = reduceChatEvent(state, { type: "prompt_done", sessionId: "s" });
		expect(state.running).toBe(false);
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s",
			event: {
				type: "message_update",
				message: {
					id: "a1",
					role: "assistant",
					content: [{ type: "text", text: "late" }],
				},
			},
		});
		expect(state.running).toBe(false);
	});

	it("does not resurrect running from late tool events after idle", () => {
		let state = createChatState();
		state = reduceChatEvent(state, { type: "prompt_done", sessionId: "s" });
		expect(state.running).toBe(false);
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s",
			event: {
				type: "tool_execution_start",
				toolCallId: "late",
				toolName: "read",
				args: { path: "x" },
			},
		});
		expect(state.running).toBe(false);
	});

	it("allows agent_start to set running again after idle", () => {
		let state = createChatState();
		state = reduceChatEvent(state, { type: "prompt_done", sessionId: "s" });
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s",
			event: { type: "agent_start" },
		});
		expect(state.running).toBe(true);
	});

	it("keeps running on agent_end when willRetry", () => {
		let state = createChatState();
		state = { ...state, running: true };
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s",
			event: { type: "agent_end", willRetry: true },
		});
		expect(state.running).toBe(true);
	});

	it("marks idle on agent_settled", () => {
		let state = createChatState();
		state = { ...state, running: true };
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s",
			event: { type: "agent_settled" },
		});
		expect(state.running).toBe(false);
	});

	it("marks idle on prompt_done", () => {
		let state = createChatState();
		state = { ...state, running: true };
		state = reduceChatEvent(state, { type: "prompt_done", sessionId: "s" });
		expect(state.running).toBe(false);
	});

	it("records prompt_error", () => {
		let state = createChatState();
		state = { ...state, running: true };
		state = reduceChatEvent(state, {
			type: "prompt_error",
			sessionId: "s",
			errorMessage: "auth failed",
		});
		expect(state.running).toBe(false);
		expect(state.messages.at(-1)).toMatchObject({
			role: "error",
			text: "auth failed",
		});
	});

	it("surfaces assistant stopReason error as chat error", () => {
		let state = createChatState();
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s",
			event: {
				type: "message_end",
				message: {
					role: "assistant",
					content: [],
					stopReason: "error",
					errorMessage: "Invalid API key",
				},
			},
		});
		expect(state.running).toBe(false);
		expect(state.messages.at(-1)).toMatchObject({
			role: "error",
		});
		expect(String((state.messages.at(-1) as { text: string }).text)).toMatch(
			/API Key|api key|Invalid/i,
		);
	});

	it("surfaces auto_retry_end failure", () => {
		let state = createChatState();
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s",
			event: {
				type: "auto_retry_end",
				success: false,
				attempt: 3,
				finalError: "rate limited",
			},
		});
		expect(state.messages.at(-1)).toMatchObject({
			role: "error",
		});
		expect(
			String((state.messages.at(-1) as { text: string }).text).length,
		).toBeGreaterThan(0);
	});

	it("stores retry hint on auto_retry_start", () => {
		let state = createChatState();
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s",
			event: {
				type: "auto_retry_start",
				attempt: 2,
				maxAttempts: 3,
				delayMs: 1000,
				errorMessage: "429 rate limit",
			},
		});
		expect(state.running).toBe(true);
		expect(state.retryHint).toMatchObject({ attempt: 2, maxAttempts: 3 });
	});

	it("does not shrink thinking when a later snapshot is only a short title", () => {
		let state = createChatState();
		const longThinking =
			"**Adjusting proxy configuration**\n\nI need to check the proxy env and rewrite the spawn path so Windows can launch the CLI.";
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s",
			event: {
				type: "message_update",
				message: {
					role: "assistant",
					content: [{ type: "thinking", thinking: longThinking }],
				},
				assistantMessageEvent: { type: "thinking_delta", delta: "" },
			},
		});
		expect(state.streamingMessage).toMatchObject({
			role: "assistant",
			thinking: longThinking,
		});

		// SDK/model replaces thinking part with a short section heading.
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s",
			event: {
				type: "message_update",
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "**Adjusting proxy configuration**" },
					],
				},
				assistantMessageEvent: {
					type: "thinking_end",
					content: "**Adjusting proxy configuration**",
				},
			},
		});
		expect(state.streamingMessage).toMatchObject({
			role: "assistant",
			thinking: longThinking,
		});
	});

	it("streams thinking text via thinking_delta and keeps it on message_end", () => {
		let state = createChatState();
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s",
			event: {
				type: "message_update",
				message: {
					role: "assistant",
					content: [{ type: "thinking", thinking: "Let me" }],
				},
				assistantMessageEvent: { type: "thinking_delta", delta: " check" },
			},
		});
		expect(state.streamingMessage).toMatchObject({
			role: "assistant",
			thinking: "Let me",
		});

		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s",
			event: {
				type: "message_update",
				message: {
					role: "assistant",
					content: [{ type: "thinking", thinking: "Let me check the file" }],
				},
				assistantMessageEvent: {
					type: "thinking_delta",
					delta: " the file",
				},
			},
		});
		expect(state.streamingMessage).toMatchObject({
			role: "assistant",
			thinking: "Let me check the file",
		});

		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s",
			event: {
				type: "message_end",
				message: {
					role: "assistant",
					id: "a1",
					content: [
						{ type: "thinking", thinking: "Let me check the file" },
						{ type: "text", text: "Done." },
					],
				},
			},
		});
		expect(state.streamingMessage).toBeNull();
		expect(state.messages.at(-1)).toMatchObject({
			role: "assistant",
			text: "Done.",
			thinking: "Let me check the file",
		});
	});

	it("keeps partial thinking/text on abort and shows cancelled notice", () => {
		let state = createChatState();
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s",
			event: {
				type: "message_update",
				message: {
					role: "assistant",
					content: [{ type: "thinking", thinking: "Analyzing…" }],
				},
				assistantMessageEvent: { type: "thinking_delta", delta: "" },
			},
		});
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s",
			event: {
				type: "message_update",
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "Analyzing…" },
						{ type: "text", text: "Partial answer" },
					],
				},
				assistantMessageEvent: { type: "text_delta", delta: "" },
			},
		});
		expect(state.streamingMessage).toMatchObject({
			role: "assistant",
			thinking: "Analyzing…",
			text: "Partial answer",
		});

		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s",
			event: {
				type: "message_end",
				message: {
					role: "assistant",
					id: "a-abort",
					content: [
						{ type: "thinking", thinking: "Analyzing…" },
						{ type: "text", text: "Partial answer" },
					],
					stopReason: "aborted",
					errorMessage: "Aborted",
				},
			},
		});

		expect(state.streamingMessage).toBeNull();
		expect(state.running).toBe(false);
		const assistant = state.messages.find((m) => m.role === "assistant");
		expect(assistant).toMatchObject({
			role: "assistant",
			thinking: "Analyzing…",
			text: "Partial answer",
			streaming: false,
		});
		expect(state.messages.at(-1)).toMatchObject({
			role: "error",
			variant: "cancelled",
		});
		expect(String((state.messages.at(-1) as { text: string }).text)).toMatch(
			/已停止|stopped/i,
		);
	});

	it("does not set pendingAskUser from ask_user tool_execution_start (IPC owns the strip)", () => {
		let state = createChatState();
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s1",
			event: {
				type: "tool_execution_start",
				toolCallId: "t1",
				toolName: ASK_USER_TOOL_NAME,
				args: {
					questions: [
						{
							id: "q1",
							prompt: "Pick",
							type: "single",
							options: [{ id: "a", label: "A" }],
						},
					],
				},
			},
		});
		expect(state.pendingAskUser).toBeNull();
		expect(state.streamingMessage).toMatchObject({
			role: "tool",
			toolName: ASK_USER_TOOL_NAME,
			streaming: true,
		});
	});

	it("setPendingAskUser stores the interactive prompt", () => {
		let state = createChatState();
		state = setPendingAskUser(state, {
			sessionId: "s1",
			requestId: "req-1",
			questions: [
				{
					id: "q1",
					prompt: "Pick",
					type: "single",
					options: [{ id: "a", label: "A" }],
				},
			],
		});
		expect(state.pendingAskUser?.questions[0]?.id).toBe("q1");
		expect(state.pendingAskUser?.requestId).toBe("req-1");
	});

	it("clearPendingAskUser drops pending prompt without adding a message", () => {
		let state = createChatState();
		state = {
			...state,
			pendingAskUser: {
				questions: [
					{
						id: "q1",
						prompt: "Pick",
						type: "single",
						options: [{ id: "a", label: "A" }],
					},
				],
			},
		};
		state = clearPendingAskUser(state);
		expect(state.pendingAskUser).toBeNull();
		expect(state.messages).toHaveLength(0);
	});

	it("clears pendingAskUser when appending a user message", () => {
		let state = createChatState();
		state = {
			...state,
			pendingAskUser: {
				questions: [
					{
						id: "q1",
						prompt: "Pick",
						type: "single",
						options: [{ id: "a", label: "A" }],
					},
				],
			},
		};
		state = appendUserMessage(state, "hello");
		expect(state.pendingAskUser).toBeNull();
	});

	it("ask_user tool_execution_start does not clear an existing pendingAskUser", () => {
		let state = createChatState();
		state = setPendingAskUser(state, {
			sessionId: "s1",
			requestId: "req-old",
			questions: [
				{
					id: "old",
					prompt: "Old",
					type: "buttons",
					options: [{ id: "y", label: "Yes" }],
				},
			],
		});
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s1",
			event: {
				type: "tool_execution_start",
				toolCallId: "t1",
				toolName: ASK_USER_TOOL_NAME,
				args: { questions: [] },
			},
		});
		expect(state.pendingAskUser?.questions[0]?.id).toBe("old");
		expect(state.pendingAskUser?.requestId).toBe("req-old");
	});

	it("setPendingAskUser replaces a previous prompt", () => {
		let state = createChatState();
		state = setPendingAskUser(state, {
			sessionId: "s1",
			requestId: "req-1",
			questions: [
				{
					id: "old",
					prompt: "Old",
					type: "buttons",
					options: [{ id: "y", label: "Yes" }],
				},
			],
		});
		state = setPendingAskUser(state, {
			sessionId: "s1",
			requestId: "req-2",
			questions: [
				{
					id: "new",
					prompt: "New",
					type: "buttons",
					options: [{ id: "n", label: "No" }],
				},
			],
		});
		expect(state.pendingAskUser?.questions[0]?.id).toBe("new");
		expect(state.pendingAskUser?.requestId).toBe("req-2");
	});

	it("keeps pendingAskUser on non-ask_user tool_execution_start", () => {
		let state = createChatState();
		state = {
			...state,
			pendingAskUser: {
				questions: [
					{
						id: "q1",
						prompt: "Pick",
						type: "single",
						options: [{ id: "a", label: "A" }],
					},
				],
			},
		};
		state = reduceChatEvent(state, {
			type: "agent_event",
			sessionId: "s1",
			event: {
				type: "tool_execution_start",
				toolCallId: "t1",
				toolName: "read",
				args: { path: "foo.txt" },
			},
		});
		expect(state.pendingAskUser?.questions[0]?.id).toBe("q1");
	});

	it("surfaces worker_stuck as an error bubble in chat", () => {
		let state = createChatState();
		state = { ...state, running: true };
		state = reduceChatEvent(state, { type: "worker_stuck", sessionId: "s1" });
		expect(state.running).toBe(false);
		const last = state.messages.at(-1);
		expect(last?.role).toBe("error");
		expect(last && last.role === "error" ? last.text : "").toMatch(/Worker/i);
	});

	it("surfaces non-zero worker_exit as an error bubble", () => {
		let state = createChatState();
		state = reduceChatEvent(state, {
			type: "worker_exit",
			sessionId: "s1",
			code: 1,
		});
		const last = state.messages.at(-1);
		expect(last?.role).toBe("error");
		expect(last && last.role === "error" ? last.text : "").toMatch(/1/);
	});

	it("keeps clean worker_exit silent in chat", () => {
		let state = createChatState();
		state = reduceChatEvent(state, {
			type: "worker_exit",
			sessionId: "s1",
			code: 0,
		});
		expect(state.messages.some((m) => m.role === "error")).toBe(false);
	});
});

it("captures usage + duration on assistant message_end", () => {
	let state = createChatState();
	state = { ...state, turnStartedAt: Date.now() - 12_400 };
	state = reduceChatEvent(state, {
		type: "agent_event",
		sessionId: "s1",
		event: {
			type: "message_end",
			message: {
				role: "assistant",
				id: "a1",
				content: [{ type: "text", text: "Done." }],
				usage: { input: 800, output: 420, totalTokens: 1220 },
			},
		},
	});
	const last = state.messages.at(-1);
	expect(last?.role).toBe("assistant");
	if (last?.role !== "assistant") return;
	expect(last.usage).toEqual({ input: 800, output: 420, totalTokens: 1220 });
	expect(last.durationMs).toBeGreaterThanOrEqual(12_400);
});

describe("hasLiveTurnState", () => {
	function pending(): NonNullable<ChatState["pendingAskUser"]> {
		return {
			sessionId: "s1",
			requestId: "req-1",
			questions: [
				{
					id: "q1",
					prompt: "Pick",
					type: "buttons",
					options: [{ id: "y", label: "Yes" }],
				},
			],
		};
	}

	it("reports idle chat as not live", () => {
		expect(hasLiveTurnState(createChatState())).toBe(false);
	});

	it("reports a session waiting on ask_user as live", () => {
		const state = setPendingAskUser(createChatState(), pending());
		expect(hasLiveTurnState(state)).toBe(true);
	});

	it("reports a running / streaming session as live", () => {
		expect(hasLiveTurnState({ ...createChatState(), running: true })).toBe(true);
		expect(
			hasLiveTurnState({
				...createChatState(),
				streamingMessage: {
					id: "a1",
					role: "assistant",
					text: "hi",
					streaming: true,
				},
			}),
		).toBe(true);
	});

	it("reports an idle chat with only history as not live", () => {
		const state = appendUserMessage(createChatState(), "hello");
		const settled = reduceChatEvent(state, {
			type: "prompt_done",
			sessionId: "s1",
		});
		expect(hasLiveTurnState(settled)).toBe(false);
	});
});

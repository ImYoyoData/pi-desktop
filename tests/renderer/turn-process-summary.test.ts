import { describe, expect, it } from "vitest";
import {
	collectTurnProcessAnchors,
	formatTurnProcessView,
	type ProcessSummaryLabels,
} from "../../src/renderer/src/utils/turn-process-summary";
import type { ChatMessage } from "../../src/renderer/src/stores/chat-reducer";

const labels: ProcessSummaryLabels = {
	exploringFiles: (n) => (n === 1 ? "Exploring 1 file" : `Exploring ${n} files`),
	exploredFiles: (n) => (n === 1 ? "explored 1 file" : `explored ${n} files`),
	editingFiles: (n) => (n === 1 ? "Editing 1 file" : `Editing ${n} files`),
	editedFiles: (n) => (n === 1 ? "Edited 1 file" : `Edited ${n} files`),
	searches: (n) => (n === 1 ? "1 search" : `${n} searches`),
	tools: (n) => (n === 1 ? "1 tool" : `${n} tools`),
	join: ", ",
	thinking: "Thinking",
	thoughtFor: (d) => `Thought ${d}`,
	thoughtBriefly: "Thought briefly",
	planning: "Planning next moves",
	formatDuration: (ms) => `${Math.round(ms / 1000)}s`,
};

describe("formatTurnProcessView", () => {
	it("matches Cursor exploring header", () => {
		expect(
			formatTurnProcessView(
				{
					editedFiles: 0,
					exploredFiles: 6,
					searches: 1,
					otherTools: 0,
					additions: 0,
					deletions: 0,
					hasThinking: true,
					thinkingDurationMs: 1000,
					live: true,
					thinkingStreaming: false,
					primary: "explore",
				},
				labels,
				4,
			),
		).toEqual({
			summary: "Exploring 6 files, 1 search",
			expandable: true,
		});
	});

	it("matches Cursor editing header with expandable steps", () => {
		expect(
			formatTurnProcessView(
				{
					editedFiles: 4,
					exploredFiles: 0,
					searches: 0,
					otherTools: 0,
					additions: 567,
					deletions: 446,
					hasThinking: false,
					thinkingDurationMs: null,
					live: true,
					thinkingStreaming: false,
					primary: "edit",
				},
				labels,
				3,
			),
		).toEqual({
			summary: "Editing 4 files",
			expandable: true,
		});
	});

	it("collapses short thinking", () => {
		expect(
			formatTurnProcessView(
				{
					editedFiles: 0,
					exploredFiles: 0,
					searches: 0,
					otherTools: 0,
					additions: 0,
					deletions: 0,
					hasThinking: true,
					thinkingDurationMs: 800,
					live: false,
					thinkingStreaming: false,
					primary: "thought",
				},
				labels,
				1,
			),
		).toEqual({
			summary: "Thought briefly",
			expandable: true,
		});
	});
});

describe("collectTurnProcessAnchors", () => {
	it("anchors summary on the LAST process row (above the conclusion)", () => {
		const messages = [
			{ id: "u1", role: "user", text: "hi" },
			{
				id: "a1",
				role: "assistant",
				text: "",
				thinking: "plan",
				thinkingDurationMs: 1500,
				streaming: false,
			},
			{
				id: "t1",
				role: "tool",
				toolName: "read",
				args: { path: "a.ts" },
				result: "x",
				streaming: false,
			},
			{
				id: "t2",
				role: "tool",
				toolName: "edit",
				args: { path: "a.ts" },
				result: { additions: 1, deletions: 0 },
				streaming: false,
			},
			{
				id: "a2",
				role: "assistant",
				text: "done",
				thinking: "",
				streaming: false,
			},
		] as unknown as ChatMessage[];

		const map = collectTurnProcessAnchors(messages);
		// Summary sits on last tool (t2), immediately above answer a2 — not on a1.
		expect(map.has("t2")).toBe(true);
		expect(map.has("a1")).toBe(false);
		expect(map.has("a2")).toBe(false);
		const anchor = map.get("t2")!;
		expect(anchor.segmentId).toBe("a1");
		expect(anchor.hiddenIds.has("a1")).toBe(true);
		expect(anchor.hiddenIds.has("t1")).toBe(true);
		expect(anchor.hiddenIds.has("t2")).toBe(false);
		expect(anchor.stats.exploredFiles).toBe(1);
		expect(anchor.toolMsgIds).toEqual(["t1", "t2"]);
		expect(anchor.steps.length).toBeGreaterThan(0);
		expect(anchor.liveAction).toBeNull();
	});

	it("keeps trailing turn live with current action under summary", () => {
		const messages = [
			{ id: "u1", role: "user", text: "hi" },
			{
				id: "t1",
				role: "tool",
				toolName: "read",
				args: { path: "a.ts" },
				result: "x",
				streaming: false,
			},
		] as unknown as ChatMessage[];
		const map = collectTurnProcessAnchors(messages, undefined, {
			trailingLive: true,
		});
		const anchor = map.get("t1")!;
		expect(anchor.stats.live).toBe(true);
		expect(anchor.liveAction).toBe("Planning next moves");
		expect(formatTurnProcessView(anchor.stats, labels, anchor.steps.length)).toEqual({
			summary: "Exploring 1 file",
			expandable: true,
		});
	});

	it("exposes live reading action while a tool streams", () => {
		const messages = [
			{ id: "u1", role: "user", text: "hi" },
			{
				id: "t1",
				role: "tool",
				toolName: "read",
				args: { path: "/tmp/MessageList.vue", offset: 2088, limit: 50 },
				result: null,
				streaming: true,
			},
		] as unknown as ChatMessage[];
		const map = collectTurnProcessAnchors(messages, undefined, {
			trailingLive: true,
		});
		const anchor = map.get("t1")!;
		expect(anchor.stats.live).toBe(true);
		expect(anchor.liveAction).toMatch(/^Reading MessageList\.vue/);
	});

	it("splits process segments around assistant answer text", () => {
		const messages = [
			{ id: "u1", role: "user", text: "hi" },
			{
				id: "a1",
				role: "assistant",
				text: "",
				thinking: "hmm",
				thinkingDurationMs: 500,
				streaming: false,
			},
			{
				id: "t1",
				role: "tool",
				toolName: "read",
				args: { path: "a.ts" },
				result: "x",
				streaming: false,
			},
			{
				id: "a2",
				role: "assistant",
				text: "found it",
				thinking: "",
				streaming: false,
			},
			{
				id: "t2",
				role: "tool",
				toolName: "edit",
				args: { path: "b.ts" },
				result: { additions: 2, deletions: 1 },
				streaming: false,
			},
		] as unknown as ChatMessage[];
		const map = collectTurnProcessAnchors(messages);
		// Explore burst ends on t1 (above a2). Edit burst ends on t2.
		expect(map.has("t1")).toBe(true);
		expect(map.has("t2")).toBe(true);
		expect(map.get("t1")!.stats.exploredFiles).toBe(1);
		expect(map.get("t2")!.stats.editedFiles).toBe(1);
	});

	it("keeps thought+answer on the same bubble visible (no blank)", () => {
		const messages = [
			{ id: "u1", role: "user", text: "hi" },
			{
				id: "a1",
				role: "assistant",
				text: "结论在这里",
				thinking: "短思考",
				thinkingDurationMs: 600,
				streaming: false,
			},
		] as unknown as ChatMessage[];
		const map = collectTurnProcessAnchors(messages);
		expect(map.has("a1")).toBe(true);
		const anchor = map.get("a1")!;
		expect(anchor.hiddenIds.has("a1")).toBe(false);
		expect(anchor.stats.primary).toBe("thought");
	});

	it("moves live summary to the newest tool (stays at the bottom edge)", () => {
		const messages = [
			{ id: "u1", role: "user", text: "hi" },
			{
				id: "t1",
				role: "tool",
				toolName: "read",
				args: { path: "a.ts" },
				result: "x",
				streaming: false,
			},
			{
				id: "t2",
				role: "tool",
				toolName: "read",
				args: { path: "b.ts" },
				result: null,
				streaming: true,
			},
		] as unknown as ChatMessage[];
		const map = collectTurnProcessAnchors(messages, undefined, {
			trailingLive: true,
		});
		expect(map.has("t2")).toBe(true);
		expect(map.has("t1")).toBe(false);
		expect(map.get("t2")!.hiddenIds.has("t1")).toBe(true);
		expect(map.get("t2")!.stats.live).toBe(true);
	});
});

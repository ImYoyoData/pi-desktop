import { describe, expect, it } from "vitest";
import { collectTurnFileChanges } from "../../src/renderer/src/utils/turn-file-changes";
import type { ToolCard } from "../../src/renderer/src/utils/tool-diff";
import type { ChatMessage } from "../../src/renderer/src/stores/chat-reducer";

function editCard(
	path: string,
	additions: number,
	deletions: number,
): ToolCard {
	return {
		kind: "edit",
		path,
		stats: { additions, deletions },
	} as unknown as ToolCard;
}

function toolMsg(
	id: string,
	toolName: string,
	card: ToolCard,
): Extract<ChatMessage, { role: "tool" }> {
	return {
		id,
		role: "tool",
		toolCallId: id,
		toolName,
		args: {},
		result: {},
	};
}

const parse = (msg: Extract<ChatMessage, { role: "tool" }>): ToolCard => {
	const table: Record<string, ToolCard> = {
		t1: editCard("src/a.ts", 10, 2),
		t2: editCard("src/a.ts", 3, 5),
		t3: editCard("README.md", 1, 0),
	};
	return table[msg.id] ?? ({ kind: "other" } as unknown as ToolCard);
};

describe("collectTurnFileChanges", () => {
	it("aggregates per-file +/- across a turn and attaches to the last row", () => {
		const messages: ChatMessage[] = [
			{ id: "u1", role: "user", text: "do it" },
			{
				id: "a1",
				role: "assistant",
				text: "working…",
			},
			toolMsg("t1", "edit", editCard("src/a.ts", 10, 2)),
			toolMsg("t2", "edit", editCard("src/a.ts", 3, 5)),
			{ id: "a2", role: "assistant", text: "done" },
		];
		const map = collectTurnFileChanges(messages, parse, true);
		expect(map.size).toBe(1);
		const summary = map.get("a2")!;
		expect(summary.files).toEqual([
			{ path: "src/a.ts", additions: 13, deletions: 7 },
		]);
		expect(summary.totalAdditions).toBe(13);
		expect(summary.totalDeletions).toBe(7);
	});

	it("splits turns on user prompts", () => {
		const messages: ChatMessage[] = [
			{ id: "u1", role: "user", text: "one" },
			toolMsg("t1", "edit", editCard("src/a.ts", 10, 2)),
			{ id: "a1", role: "assistant", text: "ok" },
			{ id: "u2", role: "user", text: "more" },
			toolMsg("t3", "write", editCard("README.md", 1, 0)),
			{ id: "a2", role: "assistant", text: "done" },
		];
		const map = collectTurnFileChanges(messages, parse, true);
		expect(map.get("a1")!.files).toEqual([
			{ path: "src/a.ts", additions: 10, deletions: 2 },
		]);
		expect(map.get("a2")!.files).toEqual([
			{ path: "README.md", additions: 1, deletions: 0 },
		]);
	});

	it("ignores non-file tools and cards without stats/path", () => {
		const messages: ChatMessage[] = [
			{ id: "u1", role: "user", text: "x" },
			toolMsg("t9", "bash", { kind: "bash" } as unknown as ToolCard),
			toolMsg(
				"t8",
				"read",
				{ kind: "read", path: "y.ts" } as unknown as ToolCard,
			),
			toolMsg(
				"t7",
				"edit",
				{ kind: "edit", path: null, stats: null } as unknown as ToolCard,
			),
			{ id: "a1", role: "assistant", text: "ok" },
		];
		const map = collectTurnFileChanges(messages, parse, true);
		expect(map.size).toBe(0);
	});

	it("trailing turn is excluded unless includeTrailing is set", () => {
		const messages: ChatMessage[] = [
			{ id: "u1", role: "user", text: "x" },
			toolMsg("t1", "edit", editCard("src/a.ts", 10, 2)),
			{ id: "a1", role: "assistant", text: "ok" },
		];
		expect(collectTurnFileChanges(messages, parse, false).size).toBe(0);
		expect(collectTurnFileChanges(messages, parse, true).has("a1")).toBe(
			true,
		);
	});
});

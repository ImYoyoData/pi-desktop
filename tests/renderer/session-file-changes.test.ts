import { describe, expect, it } from "vitest";
import {
	aggregateFileChanges,
	hasAnyFileChange,
} from "../../src/renderer/src/utils/session-file-changes";
import type { ChatMessage } from "../../src/renderer/src/stores/chat-reducer";

function toolMsg(
	id: string,
	toolName: string,
	args: Record<string, unknown> = {},
	result: unknown = {},
	opts: { isError?: boolean } = {},
): Extract<ChatMessage, { role: "tool" }> {
	return {
		id,
		role: "tool",
		toolCallId: id,
		toolName,
		args,
		result,
		...(opts.isError ? { isError: true } : {}),
	};
}

/** Realistic pi-deck edit details so parseToolCard fills stats. */
function editDetails(add: number, del: number): unknown {
	const lines: string[] = [];
	for (let i = 0; i < add; i++) lines.push(`+added line ${i}`);
	for (let i = 0; i < del; i++) lines.push(`-removed line ${i}`);
	return { diff: `--- a/f.ts\n+++ b/f.ts\n${lines.join("\n")}` };
}

describe("aggregateFileChanges", () => {
	it("sums per-path edits across the whole session (committed + streaming)", () => {
		const messages: ChatMessage[] = [
			{ id: "u1", role: "user", text: "do it" },
			toolMsg("t1", "edit", { path: "src/a.ts" }, editDetails(10, 2)),
			toolMsg("t2", "edit", { path: "src/a.ts" }, editDetails(3, 5)),
			{ id: "a1", role: "assistant", text: "ok" },
		];
		const streaming = toolMsg("t3", "edit", { path: "src/a.ts" }, editDetails(2, 0));
		const files = aggregateFileChanges(messages, streaming);
		expect(files).toEqual([
			{ path: "src/a.ts", additions: 15, deletions: 7 },
		]);
	});

	it("sorts by path and ignores non-mutation tools", () => {
		const messages: ChatMessage[] = [
			toolMsg("r1", "read", { path: "x.ts" }),
			toolMsg("b1", "bash", { command: "ls" }),
			toolMsg("w1", "write", { path: "b.md" }, editDetails(4, 0)),
			toolMsg("e1", "edit", { path: "a.ts" }, editDetails(1, 1)),
		];
		const files = aggregateFileChanges(messages, null);
		expect(files.map((f) => f.path)).toEqual(["a.ts", "b.md"]);
	});

	it("hasAnyFileChange returns false when nothing mutated", () => {
		const messages: ChatMessage[] = [
			toolMsg("r1", "read", { path: "x.ts" }),
			toolMsg("b1", "bash", { command: "ls" }),
			{ id: "a1", role: "assistant", text: "ok" },
		];
		expect(hasAnyFileChange(messages, null)).toBe(false);
		expect(hasAnyFileChange(messages, toolMsg("s1", "edit", { path: "y" }, editDetails(1, 0)))).toBe(true);
	});
});

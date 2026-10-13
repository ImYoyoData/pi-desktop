import { afterEach, describe, expect, it } from "vitest";
import {
	clearLatestTodoWriteRows,
	createTodoWriteToolDefinition,
	getLatestTodoWriteRows,
} from "../../src/agent-worker/todo-tool";

function contentText(result: { content: unknown[] }): string {
	return result.content
		.map((c) => ("text" in (c as object) ? String((c as { text?: unknown }).text ?? "") : ""))
		.join("");
}

async function write(
	tool: ReturnType<typeof createTodoWriteToolDefinition>,
	toolCallId: string,
	todos: unknown[],
) {
	return tool.execute(toolCallId, { todos }, undefined, undefined, {} as never);
}

describe("createTodoWriteToolDefinition", () => {
	afterEach(() => {
		clearLatestTodoWriteRows();
	});

	it("returns the full list plus a next-step nudge while work is open", async () => {
		const tool = createTodoWriteToolDefinition();
		const result = await write(tool, "tc-1", [
			{ id: "1", content: "第一步", status: "completed" },
			{ id: "2", content: "第二步", status: "in_progress" },
		]);
		const text = contentText(result);
		expect(text).toContain("2 items");
		expect(text).toContain("- [in_progress] #2 第二步");
		expect(text).toContain("Next:");
		expect(result.details).toMatchObject({ activeId: "2" });
	});

	it("drops the nudge once every item is completed", async () => {
		const tool = createTodoWriteToolDefinition();
		const result = await write(tool, "tc-2", [
			{ id: "1", content: "完成", status: "completed" },
		]);
		expect(contentText(result)).not.toContain("Next:");
	});

	it("remembers the latest write until the next round clears it", async () => {
		const tool = createTodoWriteToolDefinition();
		await write(tool, "tc-3", [{ content: "开车", status: "in_progress" }]);
		expect(getLatestTodoWriteRows()?.map((r) => r.text)).toEqual(["开车"]);

		clearLatestTodoWriteRows();
		expect(getLatestTodoWriteRows()).toBeNull();
	});

	it("rejects an empty list without discarding the remembered one", async () => {
		const tool = createTodoWriteToolDefinition();
		await write(tool, "tc-4", [{ content: "保留", status: "pending" }]);
		await expect(write(tool, "tc-5", [])).rejects.toThrow(/no valid todo items/);
		expect(getLatestTodoWriteRows()?.map((r) => r.text)).toEqual(["保留"]);
	});
});

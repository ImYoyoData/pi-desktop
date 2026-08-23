import { describe, expect, it } from "vitest";
import {
	TODO_WRITE_TOOL_NAME,
	buildTodoWriteDetails,
	normalizeTodoWriteRows,
	parseTodoStatus,
	summarizeTodoWrite,
} from "../../src/shared/todo-tool";

describe("todo-tool (builtin todo_write)", () => {
	it("exposes the tool name the renderer routes as a todo tool", () => {
		// session-todos.isTodoToolName must accept it.
		expect(TODO_WRITE_TOOL_NAME).toBe("todo_write");
	});

	it("normalizes content/status rows with derived ids", () => {
		const rows = normalizeTodoWriteRows([
			{ content: "Read AGENTS.md", status: "completed" },
			{ text: "Fix bug", status: "in_progress" },
			{ content: "Run tests", status: "pending" },
		]);
		expect(rows).toEqual([
			{ id: "1", text: "Read AGENTS.md", status: "completed" },
			{ id: "2", text: "Fix bug", status: "in_progress" },
			{ id: "3", text: "Run tests", status: "pending" },
		]);
	});

	it("keeps explicit ids and skips empty rows", () => {
		const rows = normalizeTodoWriteRows([
			{ id: "a", text: "  ", status: "pending" },
			{ id: "b", content: "Real step", status: "pending" },
			{ content: "   ", status: "done" },
		]);
		expect(rows).toEqual([{ id: "b", text: "Real step", status: "pending" }]);
	});

	it("maps heterogeneous statuses onto pending/in_progress/completed", () => {
		expect(parseTodoStatus("DONE")).toBe("completed");
		expect(parseTodoStatus("in-progress")).toBe("in_progress");
		expect(parseTodoStatus("running")).toBe("in_progress");
		expect(parseTodoStatus("whatever")).toBe("pending");
	});

	it("treats done:true without status as completed", () => {
		const rows = normalizeTodoWriteRows([
			{ id: "x", text: "Legacy row", done: true },
		]);
		expect(rows).toEqual([
			{ id: "x", text: "Legacy row", status: "completed" },
		]);
	});

	it("returns null for empty/invalid input (full replace means no ghost rows)", () => {
		expect(normalizeTodoWriteRows([])).toBeNull();
		expect(normalizeTodoWriteRows(undefined)).toBeNull();
		expect(normalizeTodoWriteRows("nope")).toBeNull();
	});

	it("builds details with the active id pinned", () => {
		const rows = [
			{ id: "1", text: "A", status: "completed" as const },
			{ id: "2", text: "B", status: "in_progress" as const },
			{ id: "3", text: "C", status: "pending" as const },
		];
		const details = buildTodoWriteDetails(rows, 1234);
		expect(details).toEqual({
			todos: rows,
			activeId: "2",
			nowMs: 1234,
		});
	});

	it("summarizes counts for the model", () => {
		const text = summarizeTodoWrite([
			{ id: "1", text: "A", status: "completed" },
			{ id: "2", text: "B", status: "completed" },
			{ id: "3", text: "C", status: "in_progress" },
			{ id: "4", text: "D", status: "pending" },
		]);
		expect(text).toContain("4 items");
		expect(text).toContain("2 completed");
		expect(text).toContain("1 in progress");
	});
});

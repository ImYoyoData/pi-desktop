import { describe, expect, it } from "vitest";
import {
	filterBaselineItems,
	isTodoToolName,
	parseTodoWidgetLines,
	todoListAllDone,
	todoListVisible,
	todosFromToolArgs,
	todosFromToolDetails,
} from "../../src/renderer/src/utils/session-todos";
import { parseToolCard } from "../../src/renderer/src/utils/tool-diff";

describe("session-todos", () => {
	it("parses pi-deck-todo widget lines", () => {
		const list = parseTodoWidgetLines("pi-deck-todo", [
			"待办事项 1/2",
			"☑ #1 写测试",
			"☐ #2 修实现",
		]);
		expect(list?.title).toBe("待办事项 1/2");
		expect(list?.items).toEqual([
			{ id: "1", text: "写测试", done: true },
			{ id: "2", text: "修实现", done: false },
		]);
		expect(todoListAllDone(list!)).toBe(false);
		expect(todoListVisible(list!)).toBe(true);
	});

	it("parses active (⏳) rows and duration suffixes", () => {
		const list = parseTodoWidgetLines("pi-deck-todo", [
			"待办事项 1/3",
			"⏳ #1 正在实现 · 42s",
			"☑ #2 已完成 · 1m 23s",
			"☐ #3 排队中",
		]);
		expect(list?.items).toEqual([
			{
				id: "1",
				text: "正在实现",
				done: false,
				active: true,
				durationMs: 42000,
			},
			{ id: "2", text: "已完成", done: true, durationMs: 83000 },
			{ id: "3", text: "排队中", done: false },
		]);
	});

	it("applies activeId + timestamps from tool details", () => {
		const list = todosFromToolDetails("pi-deck-todo", {
			action: "activate",
			todos: [
				{ id: 1, text: "a", done: false, startedAt: 1000 },
				{ id: 2, text: "b", done: true, startedAt: 1000, completedAt: 5000 },
			],
			nextId: 3,
			activeId: 1,
			nowMs: 4000,
		});
		expect(list?.items).toEqual([
			{ id: "1", text: "a", done: false, active: true, durationMs: 3000 },
			{ id: "2", text: "b", done: true, durationMs: 4000 },
		]);
	});

	it("parses plan-mode widget lines", () => {
		const list = parseTodoWidgetLines("pi-deck-plan-todos", [
			"计划进度 2/2",
			"☑ 1. 调研",
			"☑ 2. 实现",
		]);
		expect(list?.items.every((i) => i.done)).toBe(true);
		expect(todoListVisible({ ...list!, dismissed: true })).toBe(false);
	});

	it("builds list from tool details and clears on clear action", () => {
		const list = todosFromToolDetails("pi-deck-todo", {
			action: "add",
			todos: [
				{ id: 1, text: "a", done: false },
				{ id: 2, text: "b", done: true },
			],
			nextId: 3,
		});
		expect(list?.items).toHaveLength(2);
		expect(
			todosFromToolDetails("pi-deck-todo", {
				action: "clear",
				todos: [],
				nextId: 1,
			}),
		).toBeNull();
	});

	it("accepts Cursor-like content/status todo_write payloads", () => {
		expect(isTodoToolName("todo_write")).toBe(true);
		const list = todosFromToolArgs("todo", {
			todos: [
				{ id: "t1", content: "Wire overlay", status: "completed" },
				{ id: "t2", content: "Add tests", status: "in_progress" },
				{ id: "t3", content: "Write README", status: "pending" },
			],
		});
		expect(list?.items).toEqual([
			{ id: "t1", text: "Wire overlay", done: true },
			{ id: "t2", text: "Add tests", done: false },
			{ id: "t3", text: "Write README", done: false },
		]);
	});

	it("ignores incremental pi-deck add args without a full list", () => {
		expect(
			todosFromToolArgs("todo", { action: "add", text: "only one" }),
		).toBeNull();
	});

	it("parses a dedicated todo tool card", () => {
		const card = parseToolCard(
			"todo",
			{ action: "add", text: "x" },
			{
				content: [{ type: "text", text: "Added todo #1: x" }],
				details: {
					action: "add",
					todos: [
						{ id: 1, text: "x", done: false },
						{ id: 2, text: "y", done: true },
					],
					nextId: 3,
				},
			},
		);
		expect(card.kind).toBe("todo");
		if (card.kind !== "todo") return;
		expect(card.items).toHaveLength(2);
		expect(card.summary).toBe("1/2");
	});

	it("hides a dismissed list even when it still has open items", () => {
		const list = parseTodoWidgetLines("pi-deck-todo", [
			"Todos 1/2",
			"☐ #1 open item",
			"☑ #2 done item",
		]);
		expect(todoListVisible({ ...list!, dismissed: true })).toBe(false);
		expect(todoListVisible({ ...list!, dismissed: false })).toBe(true);
	});
});

it("parses a finished header with total duration", () => {
	const list = parseTodoWidgetLines("pi-deck-todo", [
		"待办事项 3/3 · 总用时 2m 15s",
		"☑ #1 调研 · 45s",
		"☑ #2 实现 · 1m 20s",
		"☑ #3 验证 · 10s",
	]);
	expect(list?.title).toBe("待办事项 3/3 · 总用时 2m 15s");
	expect(list?.items).toEqual([
		{ id: "1", text: "调研", done: true, durationMs: 45000 },
		{ id: "2", text: "实现", done: true, durationMs: 80000 },
		{ id: "3", text: "验证", done: true, durationMs: 10000 },
	]);
	expect(todoListAllDone(list!)).toBe(true);
});

describe("filterBaselineItems — new-task cleanup of stale extension todos", () => {
	it("drops baseline items when the new list is a superset (agent never cleared)", () => {
		const baseline = new Set(["重构模块", "写测试"]);
		const list = parseTodoWidgetLines("pi-deck-todo", [
			"Todos 2/3",
			"☐ #1 重构模块",
			"☑ #2 写测试",
			"☐ #3 写排序算法",
		]);
		const r = filterBaselineItems(list!, baseline);
		expect(r.items.map((i) => i.text)).toEqual(["写排序算法"]);
		expect(r.baselineCleared).toBe(false);
	});

	it("keeps everything when the list no longer contains baseline (agent cleared)", () => {
		const baseline = new Set(["重构模块"]);
		const list = parseTodoWidgetLines("pi-deck-todo", [
			"Todos 0/2",
			"☐ #1 写排序算法",
			"☐ #2 跑测试",
		]);
		const r = filterBaselineItems(list!, baseline);
		expect(r.items.map((i) => i.text)).toEqual(["写排序算法", "跑测试"]);
		expect(r.baselineCleared).toBe(true);
	});

	it("empty result means the whole new list was stale (baseline persists)", () => {
		const baseline = new Set(["重构模块"]);
		const list = parseTodoWidgetLines("pi-deck-todo", [
			"Todos 0/1",
			"☐ #1 重构模块",
		]);
		const r = filterBaselineItems(list!, baseline);
		expect(r.items).toEqual([]);
		expect(r.baselineCleared).toBe(false);
	});

	it("new items appended after filtering stay visible", () => {
		const baseline = new Set(["重构模块"]);
		const first = parseTodoWidgetLines("pi-deck-todo", [
			"Todos 1/2",
			"☐ #1 重构模块",
			"☐ #2 写排序算法",
		]);
		const r1 = filterBaselineItems(first!, baseline);
		expect(r1.items.map((i) => i.text)).toEqual(["写排序算法"]);
		// next setWidget appends more new work on top of the same stale baseline
		const second = parseTodoWidgetLines("pi-deck-todo", [
			"Todos 1/3",
			"☐ #1 重构模块",
			"☐ #2 写排序算法",
			"☐ #3 写测试",
		]);
		const r2 = filterBaselineItems(second!, baseline);
		expect(r2.items.map((i) => i.text)).toEqual(["写排序算法", "写测试"]);
		expect(r2.baselineCleared).toBe(false);
	});

	it("handles identical text in old and new lists (partial overlap keeps new occurrence)", () => {
		const baseline = new Set(["重构模块"]);
		const list = parseTodoWidgetLines("pi-deck-todo", [
			"Todos 1/2",
			"☐ #1 重构模块",
			"☑ #1 重构模块", // same text re-added by new task
		]);
		const r = filterBaselineItems(list!, baseline);
		// Both rows carry baseline text; both are stale — nothing new here.
		expect(r.items).toEqual([]);
	});
});

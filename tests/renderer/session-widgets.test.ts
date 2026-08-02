import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSessionWidgetsStore } from "../../src/renderer/src/stores/session-widgets";
import { useSessionsStore } from "../../src/renderer/src/stores/sessions";

function todoWidgetLines(title: string, rows: string[]): string[] {
	return [title, ...rows];
}

describe("session-widgets — new-task baseline cleanup", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		const sessions = useSessionsStore();
		sessions.activeId = "s1";
	});

	it("drops stale extension items after reset when agent never cleared", () => {
		const w = useSessionWidgetsStore();
		// Old round: agent tracked "重构模块" in the extension widget.
		w.setWidget(
			"s1",
			"pi-deck-todo",
			todoWidgetLines("待办事项 0/1", ["☐ #1 重构模块"]),
		);
		expect(w.activeTodoList?.items.map((i) => i.text)).toEqual(["重构模块"]);

		// New task starts: desktop resets the UI and arms the baseline.
		w.resetTodosForSession("s1");
		expect(w.activeTodoList).toBeNull();

		// Agent adds new work but its extension memory still holds the old item.
		w.setWidget(
			"s1",
			"pi-deck-todo",
			todoWidgetLines("待办事项 1/2", ["☐ #1 重构模块", "☐ #2 写排序算法"]),
		);
		expect(w.activeTodoList?.items.map((i) => i.text)).toEqual(["写排序算法"]);

		// Next push appends more new work on the same stale baseline.
		w.setWidget(
			"s1",
			"pi-deck-todo",
			todoWidgetLines("待办事项 1/3", [
				"☐ #1 重构模块",
				"☐ #2 写排序算法",
				"☐ #3 跑测试",
			]),
		);
		expect(w.activeTodoList?.items.map((i) => i.text)).toEqual([
			"写排序算法",
			"跑测试",
		]);
	});

	it("keeps the full list once the agent actually cleared (baseline released)", () => {
		const w = useSessionWidgetsStore();
		w.setWidget(
			"s1",
			"pi-deck-todo",
			todoWidgetLines("待办事项 0/1", ["☐ #1 旧任务"]),
		);
		w.resetTodosForSession("s1");

		// Agent called todo clear, then added fresh items — no stale rows left.
		w.setWidget(
			"s1",
			"pi-deck-todo",
			todoWidgetLines("待办事项 0/2", ["☐ #1 新任务A", "☐ #2 新任务B"]),
		);
		expect(w.activeTodoList?.items.map((i) => i.text)).toEqual([
			"新任务A",
			"新任务B",
		]);

		// Baseline is gone: subsequent pushes pass through untouched.
		w.setWidget(
			"s1",
			"pi-deck-todo",
			todoWidgetLines("待办事项 0/3", [
				"☐ #1 新任务A",
				"☐ #2 新任务B",
				"☐ #3 新任务C",
			]),
		);
		expect(w.activeTodoList?.items.map((i) => i.text)).toEqual([
			"新任务A",
			"新任务B",
			"新任务C",
		]);
	});

	it("baseline filters tool-result pushes too (extension memory is the same source)", () => {
		const w = useSessionWidgetsStore();
		w.setWidget(
			"s1",
			"pi-deck-todo",
			todoWidgetLines("待办事项 0/1", ["☐ #1 旧任务"]),
		);
		w.resetTodosForSession("s1");

		w.applyTodoToolResult("s1", {
			action: "add",
			todos: [
				{ id: 1, text: "旧任务", done: false },
				{ id: 2, text: "新任务", done: false },
			],
			nextId: 3,
		});
		expect(w.activeTodoList?.items.map((i) => i.text)).toEqual(["新任务"]);
	});

	it("clearSession releases the baseline for that session", () => {
		const w = useSessionWidgetsStore();
		w.setWidget(
			"s1",
			"pi-deck-todo",
			todoWidgetLines("待办事项 0/1", ["☐ #1 旧任务"]),
		);
		w.resetTodosForSession("s1");
		w.clearSession("s1");

		// No baseline armed: new list passes through in full.
		w.setWidget(
			"s1",
			"pi-deck-todo",
			todoWidgetLines("待办事项 0/2", ["☐ #1 旧任务", "☐ #2 新任务"]),
		);
		expect(w.activeTodoList?.items.map((i) => i.text)).toEqual([
			"旧任务",
			"新任务",
		]);
	});
});

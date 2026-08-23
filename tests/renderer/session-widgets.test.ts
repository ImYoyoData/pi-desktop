import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSessionWidgetsStore } from "../../src/renderer/src/stores/session-widgets";
import { useSessionsStore } from "../../src/renderer/src/stores/sessions";

function todoWidgetLines(title: string, rows: string[]): string[] {
	return [title, ...rows];
}

describe("session-widgets — full-replace todo lists", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		const sessions = useSessionsStore();
		sessions.activeId = "s1";
	});

	it("replaces the whole list on every update — old items never linger", () => {
		const w = useSessionWidgetsStore();
		w.setWidget(
			"s1",
			"pi-deck-todo",
			todoWidgetLines("待办事项 0/1", ["☐ #1 旧任务"]),
		);
		expect(w.activeTodoList?.items.map((i) => i.text)).toEqual(["旧任务"]);

		// New task: the fresh list REPLACES the old one entirely.
		w.setWidget(
			"s1",
			"pi-deck-todo",
			todoWidgetLines("待办事项 0/2", ["☐ #1 新任务A", "☐ #2 新任务B"]),
		);
		expect(w.activeTodoList?.items.map((i) => i.text)).toEqual([
			"新任务A",
			"新任务B",
		]);
	});

	it("new prompt reset wipes the list; next push shows only the new round's items", () => {
		const w = useSessionWidgetsStore();
		w.applyTodoToolArgs("s1", {
			todos: [
				{ id: "1", content: "上一轮步骤", status: "completed" },
				{ id: "2", content: "上一轮另一步", status: "completed" },
			],
		});
		expect(w.activeTodoList?.items).toHaveLength(2);

		w.resetTodosForSession("s1");
		expect(w.activeTodoList).toBeNull();

		w.applyTodoToolArgs("s1", {
			todos: [{ id: "1", content: "全新任务", status: "in_progress" }],
		});
		expect(w.activeTodoList?.items.map((i) => i.text)).toEqual(["全新任务"]);
	});

	it("builtin tool ownership: extension widget pushes are ignored after todo_write", () => {
		const w = useSessionWidgetsStore();
		w.applyTodoToolArgs("s1", {
			todos: [{ id: "1", content: "工具写入的列表", status: "pending" }],
		});
		expect(w.activeTodoList?.items.map((i) => i.text)).toEqual([
			"工具写入的列表",
		]);

		// Stale pi-deck extension re-push (old memory) must not clobber it.
		w.setWidget(
			"s1",
			"pi-deck-todo",
			todoWidgetLines("待办事项 0/2", ["☐ #1 扩展旧条目", "☐ #2 另一个"]),
		);
		expect(w.activeTodoList?.items.map((i) => i.text)).toEqual([
			"工具写入的列表",
		]);

		// New task reset releases ownership — widget pushes apply again.
		w.resetTodosForSession("s1");
		w.setWidget(
			"s1",
			"pi-deck-todo",
			todoWidgetLines("待办事项 0/1", ["☐ #1 扩展列表"]),
		);
		expect(w.activeTodoList?.items.map((i) => i.text)).toEqual(["扩展列表"]);
	});

	it("per-item timers freeze on completion and stay attached by text across updates", () => {
		const w = useSessionWidgetsStore();
		w.applyTodoToolArgs("s1", {
			todos: [
				{ id: "1", text: "读代码", status: "completed" },
				{ id: "2", text: "改实现", status: "in_progress" },
			],
		});
		const first = w.activeTodoList!.items;
		const doneItem = first.find((i) => i.text === "读代码")!;
		const liveItem = first.find((i) => i.text === "改实现")!;
		expect(doneItem.done).toBe(true);
		expect(doneItem.startedAt).toBeUndefined();
		expect(liveItem.startedAt).toBeGreaterThan(0);

		const startedAt = liveItem.startedAt!;
		// Next update renumbers ids but keeps the same texts — timer continues.
		w.applyTodoToolArgs("s1", {
			todos: [
				{ id: "7", text: "改实现", status: "completed" },
				{ id: "8", text: "跑测试", status: "in_progress" },
			],
		});
		const second = w.activeTodoList!.items;
		const finished = second.find((i) => i.text === "改实现")!;
		const fresh = second.find((i) => i.text === "跑测试")!;
		expect(finished.durationMs).toBeGreaterThanOrEqual(0);
		// Removed item stays gone; only the new open row remains.
		expect(second.map((i) => i.text)).toEqual(["改实现", "跑测试"]);
		expect(fresh.startedAt).toBeGreaterThanOrEqual(startedAt);
	});

	it("finalize auto-completes items the model left open when the turn ends", () => {
		const w = useSessionWidgetsStore();
		w.applyTodoToolArgs("s1", {
			todos: [
				{ id: "1", content: "已完成步骤", status: "completed" },
				{ id: "2", content: "忘了标记的步骤", status: "in_progress" },
			],
		});
		expect(w.activeTodoList?.items.some((i) => !i.done)).toBe(true);

		w.finalizeTodosForSession("s1");

		const items = w.activeTodoList!.items;
		expect(items.every((i) => i.done)).toBe(true);
		const late = items.find((i) => i.text === "忘了标记的步骤")!;
		expect(late.durationMs).toBeGreaterThanOrEqual(0);
		// Round clock closed so the header can show the total time.
		expect(w.todoCompletedAt("s1")).toBeGreaterThan(0);
	});

	it("finalize skips paused lists — stopped rounds are never auto-completed", () => {
		const w = useSessionWidgetsStore();
		w.applyTodoToolArgs("s1", {
			todos: [{ id: "1", content: "进行中的活", status: "in_progress" }],
		});
		w.pauseTodosForSession("s1");
		w.finalizeTodosForSession("s1");

		const list = w.activeTodoList!;
		expect(list.paused).toBe(true);
		expect(list.items.some((i) => !i.done)).toBe(true);
		// Round clock stays open while paused.
		expect(w.todoCompletedAt("s1")).toBe(0);
	});

	it("resume keeps the list across the next prompt reset (consumed once)", () => {
		const w = useSessionWidgetsStore();
		w.applyTodoToolArgs("s1", {
			todos: [{ id: "1", content: "被中断的步骤", status: "in_progress" }],
		});
		w.pauseTodosForSession("s1");
		w.resumeTodosForSession("s1");
		expect(w.activeTodoList?.paused).toBe(false);

		// Follow-up prompt: the reset is skipped so the task can continue.
		w.resetTodosForSession("s1");
		expect(w.activeTodoList?.items.map((i) => i.text)).toEqual([
			"被中断的步骤",
		]);

		// The skip was one-shot: a later new-task reset wipes again.
		w.resetTodosForSession("s1");
		expect(w.activeTodoList).toBeNull();
	});

	it("delete drops the paused list entirely", () => {
		const w = useSessionWidgetsStore();
		w.applyTodoToolArgs("s1", {
			todos: [{ id: "1", content: "任意", status: "pending" }],
		});
		w.pauseTodosForSession("s1");
		w.deleteTodoList("s1");
		expect(w.activeTodoList).toBeNull();
	});

	it("pause is a no-op when everything is already done", () => {
		const w = useSessionWidgetsStore();
		w.applyTodoToolArgs("s1", {
			todos: [{ id: "1", content: "已完成", status: "completed" }],
		});
		const before = w.activeTodoList;
		w.pauseTodosForSession("s1");
		expect(w.activeTodoList).toEqual(before);
	});

	it("clearSession drops all per-session todo state", () => {
		const w = useSessionWidgetsStore();
		w.applyTodoToolArgs("s1", {
			todos: [{ id: "1", content: "任意", status: "pending" }],
		});
		w.clearSession("s1");
		expect(w.activeTodoList).toBeNull();
	});
});

import { beforeEach, describe, expect, it } from "vitest";
import { useSessionWidgetsStore } from "../../src/renderer/src/stores/session-widgets";
import { useSessionsStore } from "../../src/renderer/src/stores/sessions";

function todoWidgetLines(title: string, rows: string[]): string[] {
	return [title, ...rows];
}

describe("session-widgets — full-replace todo lists", () => {
	beforeEach(() => {
		useSessionsStore.setState(useSessionsStore.getInitialState(), true);
		useSessionWidgetsStore.setState(useSessionWidgetsStore.getInitialState(), true);
		useSessionsStore.setState({ activeId: "s1" });
	});

	it("replaces the whole list on every update — old items never linger", () => {
		useSessionWidgetsStore
			.getState()
			.setWidget(
				"s1",
				"pi-deck-todo",
				todoWidgetLines("待办事项 0/1", ["☐ #1 旧任务"]),
			);
		expect(
			useSessionWidgetsStore.getState().activeTodoList?.items.map((i) => i.text),
		).toEqual(["旧任务"]);

		// New task: the fresh list REPLACES the old one entirely.
		useSessionWidgetsStore
			.getState()
			.setWidget(
				"s1",
				"pi-deck-todo",
				todoWidgetLines("待办事项 0/2", ["☐ #1 新任务A", "☐ #2 新任务B"]),
			);
		expect(
			useSessionWidgetsStore.getState().activeTodoList?.items.map((i) => i.text),
		).toEqual(["新任务A", "新任务B"]);
	});

	it("new prompt reset wipes the list; next push shows only the new round's items", () => {
		useSessionWidgetsStore.getState().applyTodoToolArgs("s1", {
			todos: [
				{ id: "1", content: "上一轮步骤", status: "completed" },
				{ id: "2", content: "上一轮另一步", status: "completed" },
			],
		});
		expect(useSessionWidgetsStore.getState().activeTodoList?.items).toHaveLength(2);

		useSessionWidgetsStore.getState().resetTodosForSession("s1");
		expect(useSessionWidgetsStore.getState().activeTodoList).toBeNull();

		useSessionWidgetsStore.getState().applyTodoToolArgs("s1", {
			todos: [{ id: "1", content: "全新任务", status: "in_progress" }],
		});
		expect(
			useSessionWidgetsStore.getState().activeTodoList?.items.map((i) => i.text),
		).toEqual(["全新任务"]);
	});

	it("builtin tool ownership: extension widget pushes are ignored after todo_write", () => {
		useSessionWidgetsStore.getState().applyTodoToolArgs("s1", {
			todos: [{ id: "1", content: "工具写入的列表", status: "pending" }],
		});
		expect(
			useSessionWidgetsStore.getState().activeTodoList?.items.map((i) => i.text),
		).toEqual(["工具写入的列表"]);

		// Stale pi-deck extension re-push (old memory) must not clobber it.
		useSessionWidgetsStore
			.getState()
			.setWidget(
				"s1",
				"pi-deck-todo",
				todoWidgetLines("待办事项 0/2", ["☐ #1 扩展旧条目", "☐ #2 另一个"]),
			);
		expect(
			useSessionWidgetsStore.getState().activeTodoList?.items.map((i) => i.text),
		).toEqual(["工具写入的列表"]);

		// New task reset releases ownership — widget pushes apply again.
		useSessionWidgetsStore.getState().resetTodosForSession("s1");
		useSessionWidgetsStore
			.getState()
			.setWidget(
				"s1",
				"pi-deck-todo",
				todoWidgetLines("待办事项 0/1", ["☐ #1 扩展列表"]),
			);
		expect(
			useSessionWidgetsStore.getState().activeTodoList?.items.map((i) => i.text),
		).toEqual(["扩展列表"]);
	});

	it("per-item timers freeze on completion and stay attached by text across updates", () => {
		useSessionWidgetsStore.getState().applyTodoToolArgs("s1", {
			todos: [
				{ id: "1", text: "读代码", status: "completed" },
				{ id: "2", text: "改实现", status: "in_progress" },
			],
		});
		const first = useSessionWidgetsStore.getState().activeTodoList!.items;
		const doneItem = first.find((i) => i.text === "读代码")!;
		const liveItem = first.find((i) => i.text === "改实现")!;
		expect(doneItem.done).toBe(true);
		expect(doneItem.startedAt).toBeUndefined();
		expect(liveItem.startedAt).toBeGreaterThan(0);

		const startedAt = liveItem.startedAt!;
		// Next update renumbers ids but keeps the same texts — timer continues.
		useSessionWidgetsStore.getState().applyTodoToolArgs("s1", {
			todos: [
				{ id: "7", text: "改实现", status: "completed" },
				{ id: "8", text: "跑测试", status: "in_progress" },
			],
		});
		const second = useSessionWidgetsStore.getState().activeTodoList!.items;
		const finished = second.find((i) => i.text === "改实现")!;
		const fresh = second.find((i) => i.text === "跑测试")!;
		expect(finished.durationMs).toBeGreaterThanOrEqual(0);
		// Removed item stays gone; only the new open row remains.
		expect(second.map((i) => i.text)).toEqual(["改实现", "跑测试"]);
		expect(fresh.startedAt).toBeGreaterThanOrEqual(startedAt);
	});

	it("finalize marks unconfirmed items as unreported instead of completing them", () => {
		useSessionWidgetsStore.getState().applyTodoToolArgs("s1", {
			todos: [
				{ id: "1", content: "已完成步骤", status: "completed" },
				{ id: "2", content: "忘了标记的步骤", status: "in_progress" },
			],
		});
		expect(
			useSessionWidgetsStore.getState().activeTodoList?.items.some((i) => !i.done),
		).toBe(true);

		useSessionWidgetsStore.getState().finalizeTodosForSession("s1");

		const items = useSessionWidgetsStore.getState().activeTodoList!.items;
		const late = items.find((i) => i.text === "忘了标记的步骤")!;
		expect(late.done).toBe(false);
		expect(late.unreported).toBe(true);
		expect(late.active).toBeUndefined();
		expect(late.durationMs).toBeGreaterThanOrEqual(0);
		// 还有未确认项 —— 本轮不算完成，也不允许自动收起。
		expect(useSessionWidgetsStore.getState().todoCompletedAt("s1")).toBe(0);
		expect(useSessionWidgetsStore.getState().activeTodoList!.dismissed).toBe(false);
	});

	it("finalize clears the unreported flag once the model writes again", () => {
		useSessionWidgetsStore.getState().applyTodoToolArgs("s1", {
			todos: [{ id: "1", content: "做的步骤", status: "in_progress" }],
		});
		useSessionWidgetsStore.getState().finalizeTodosForSession("s1");
		expect(
			useSessionWidgetsStore.getState().activeTodoList!.items[0].unreported,
		).toBe(true);

		useSessionWidgetsStore.getState().applyTodoToolArgs("s1", {
			todos: [
				{ id: "1", content: "做的步骤", status: "completed" },
				{ id: "2", content: "下一步", status: "in_progress" },
			],
		});
		expect(
			useSessionWidgetsStore.getState().activeTodoList!.items[0].unreported,
		).toBeUndefined();
		expect(useSessionWidgetsStore.getState().activeTodoList!.items[0].done).toBe(true);
	});

	it("finalize leaves a fully reported list untouched and closes the round clock", () => {
		useSessionWidgetsStore.getState().applyTodoToolArgs("s1", {
			todos: [{ id: "1", content: "完成", status: "completed" }],
		});
		useSessionWidgetsStore.getState().finalizeTodosForSession("s1");
		expect(useSessionWidgetsStore.getState().activeTodoList!.items[0]).toMatchObject({
			done: true,
		});
		expect(
			useSessionWidgetsStore.getState().activeTodoList?.items.some((i) => i.unreported),
		).toBe(false);
		expect(useSessionWidgetsStore.getState().todoCompletedAt("s1")).toBeGreaterThan(0);
	});

	it("finalize is idempotent and drops the live start clock", async () => {
		useSessionWidgetsStore.getState().applyTodoToolArgs("s1", {
			todos: [{ id: "1", content: "做的步骤", status: "in_progress" }],
		});
		useSessionWidgetsStore.getState().finalizeTodosForSession("s1");
		const first = useSessionWidgetsStore.getState().activeTodoList!.items[0];
		expect(first.startedAt).toBeUndefined();
		const frozen = first.durationMs;

		// 事件丢失的恢复路径会再跑一次 finalize，不能重复改动已冻结的项。
		// 隔开一毫秒，否则两次收尾落在同一刻，重算耗时的回归也测不出来。
		await new Promise((resolve) => setTimeout(resolve, 10));
		useSessionWidgetsStore.getState().finalizeTodosForSession("s1");
		expect(
			useSessionWidgetsStore.getState().activeTodoList!.items[0].durationMs,
		).toBe(frozen);
		expect(
			useSessionWidgetsStore.getState().activeTodoList!.items[0].unreported,
		).toBe(true);
		expect(useSessionWidgetsStore.getState().todoCompletedAt("s1")).toBe(0);
	});

	it("finalize skips paused lists — stopped rounds are never auto-completed", () => {
		useSessionWidgetsStore.getState().applyTodoToolArgs("s1", {
			todos: [{ id: "1", content: "进行中的活", status: "in_progress" }],
		});
		useSessionWidgetsStore.getState().pauseTodosForSession("s1");
		useSessionWidgetsStore.getState().finalizeTodosForSession("s1");

		const list = useSessionWidgetsStore.getState().activeTodoList!;
		expect(list.paused).toBe(true);
		expect(list.items.some((i) => !i.done)).toBe(true);
		// Round clock stays open while paused.
		expect(useSessionWidgetsStore.getState().todoCompletedAt("s1")).toBe(0);
	});

	it("resume keeps the list across the next prompt reset (consumed once)", () => {
		useSessionWidgetsStore.getState().applyTodoToolArgs("s1", {
			todos: [{ id: "1", content: "被中断的步骤", status: "in_progress" }],
		});
		useSessionWidgetsStore.getState().pauseTodosForSession("s1");
		useSessionWidgetsStore.getState().resumeTodosForSession("s1");
		expect(useSessionWidgetsStore.getState().activeTodoList?.paused).toBe(false);

		// Follow-up prompt: the reset is skipped so the task can continue.
		useSessionWidgetsStore.getState().resetTodosForSession("s1");
		expect(
			useSessionWidgetsStore.getState().activeTodoList?.items.map((i) => i.text),
		).toEqual(["被中断的步骤"]);

		// The skip was one-shot: a later new-task reset wipes again.
		useSessionWidgetsStore.getState().resetTodosForSession("s1");
		expect(useSessionWidgetsStore.getState().activeTodoList).toBeNull();
	});

	it("delete drops the paused list entirely", () => {
		useSessionWidgetsStore.getState().applyTodoToolArgs("s1", {
			todos: [{ id: "1", content: "任意", status: "pending" }],
		});
		useSessionWidgetsStore.getState().pauseTodosForSession("s1");
		useSessionWidgetsStore.getState().deleteTodoList("s1");
		expect(useSessionWidgetsStore.getState().activeTodoList).toBeNull();
	});

	it("pause is a no-op when everything is already done", () => {
		useSessionWidgetsStore.getState().applyTodoToolArgs("s1", {
			todos: [{ id: "1", content: "已完成", status: "completed" }],
		});
		const before = useSessionWidgetsStore.getState().activeTodoList;
		useSessionWidgetsStore.getState().pauseTodosForSession("s1");
		expect(useSessionWidgetsStore.getState().activeTodoList).toEqual(before);
	});

	it("clearSession drops all per-session todo state", () => {
		useSessionWidgetsStore.getState().applyTodoToolArgs("s1", {
			todos: [{ id: "1", content: "任意", status: "pending" }],
		});
		useSessionWidgetsStore.getState().clearSession("s1");
		expect(useSessionWidgetsStore.getState().activeTodoList).toBeNull();
	});
});

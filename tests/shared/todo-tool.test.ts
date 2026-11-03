import { describe, expect, it } from "vitest";
import {
	applyTodoParams,
	formatTodoResult,
	resolveTodoParams,
	todoProgressLine,
	type TodoPhase,
	type TodoToolParams,
} from "../../src/shared/todo-tool";

function run(phases: TodoPhase[], params: TodoToolParams) {
	return applyTodoParams(phases, params);
}

const INIT: TodoToolParams = {
	op: "init",
	list: [
		{ phase: "实现", items: ["读源码", "改实现"] },
		{ phase: "验证", items: ["跑测试"] },
	],
};

describe("todo-tool (OMP-compatible phases)", () => {
	it("init builds phases and starts the first task", () => {
		const result = run([], INIT);
		expect(result.errors).toEqual([]);
		expect(result.phases).toEqual([
			{
				name: "实现",
				tasks: [
					{ content: "读源码", status: "in_progress" },
					{ content: "改实现", status: "pending" },
				],
			},
			{ name: "验证", tasks: [{ content: "跑测试", status: "pending" }] },
		]);
	});

	it("init accepts a flat items list with an optional phase", () => {
		const result = run([], {
			op: "init",
			phase: "单阶段",
			items: ["甲", "乙"],
		});
		expect(result.phases).toEqual([
			{
				name: "单阶段",
				tasks: [
					{ content: "甲", status: "in_progress" },
					{ content: "乙", status: "pending" },
				],
			},
		]);
	});

	it("rejects duplicate phases or tasks without applying anything", () => {
		const result = run([], {
			op: "init",
			list: [
				{ phase: "A", items: ["x"] },
				{ phase: "A", items: ["x"] },
			],
		});
		expect(result.errors.join(" ")).toContain("Duplicate phase");
		expect(result.errors.join(" ")).toContain("Duplicate task");
	});

	it("treats an empty init list as a clear", () => {
		const empty = run([], { op: "init", list: [] });
		expect(empty.errors).toEqual([]);
		expect(empty.phases).toEqual([]);
		const emptyPhase = run([], { op: "init", list: [{ phase: "A", items: [] }] });
		expect(emptyPhase.errors).toEqual([]);
		expect(emptyPhase.phases).toEqual([{ name: "A", tasks: [] }]);
	});

	it("start moves the in-progress pointer", () => {
		const started = run(run([], INIT).phases, {
			op: "start",
			task: "跑测试",
		});
		const statuses = started.phases.flatMap((phase) =>
			phase.tasks.map((task) => `${task.content}:${task.status}`),
		);
		expect(statuses).toEqual([
			"读源码:pending",
			"改实现:pending",
			"跑测试:in_progress",
		]);
	});

	it("done targets a task by content or a whole phase", () => {
		const one = run(run([], INIT).phases, { op: "done", task: "读源码" });
		expect(one.phases[0]?.tasks[0]?.status).toBe("completed");
		const all = run(one.phases, { op: "done", phase: "验证" });
		expect(all.phases[1]?.tasks[0]?.status).toBe("completed");
	});

	it("drop and block/unblock keep the list consistent", () => {
		const dropped = run(run([], INIT).phases, {
			op: "drop",
			task: "改实现",
		});
		expect(dropped.phases[0]?.tasks[1]?.status).toBe("abandoned");

		const blocked = run(dropped.phases, {
			op: "block",
			task: "跑测试",
			reason: "缺 依赖\n 版本",
		});
		expect(blocked.phases[1]?.tasks[0]).toEqual({
			content: "跑测试",
			status: "blocked",
			blocker: "缺 依赖 版本",
		});

		const unblocked = run(blocked.phases, {
			op: "unblock",
			task: "跑测试",
		});
		expect(unblocked.phases[1]?.tasks[0]).toEqual({
			content: "跑测试",
			status: "pending",
		});
	});

	it("done and drop accept tasks in any open state", () => {
		const phases = run([], INIT).phases;
		const donePending = run(phases, { op: "done", task: "改实现" });
		expect(donePending.errors).toEqual([]);
		expect(donePending.phases[0]?.tasks).toEqual([
			{ content: "读源码", status: "in_progress" },
			{ content: "改实现", status: "completed" },
		]);

		const droppedActive = run(phases, { op: "drop", task: "读源码" });
		expect(droppedActive.errors).toEqual([]);
		expect(droppedActive.phases[0]?.tasks).toEqual([
			{ content: "读源码", status: "abandoned" },
			{ content: "改实现", status: "in_progress" },
		]);
	});

	it("block without a reason keeps the task blocked", () => {
		const blocked = run(run([], INIT).phases, {
			op: "block",
			task: "跑测试",
		});
		expect(blocked.errors).toEqual([]);
		expect(blocked.phases[1]?.tasks[0]).toEqual({
			content: "跑测试",
			status: "blocked",
		});
	});

	it("append adds items to an existing or new phase", () => {
		const result = run(run([], INIT).phases, {
			op: "append",
			phase: "验证",
			items: ["补文档"],
		});
		expect(result.phases[1]?.tasks.map((task) => task.content)).toEqual([
			"跑测试",
			"补文档",
		]);
	});

	it("rm clears a task, a phase, or everything", () => {
		const one = run(run([], INIT).phases, { op: "rm", task: "读源码" });
		expect(one.phases[0]?.tasks.map((task) => task.content)).toEqual(["改实现"]);
		const phase = run(one.phases, { op: "rm", phase: "验证" });
		expect(phase.phases[1]?.tasks).toEqual([]);
		const all = run(phase.phases, { op: "rm" });
		expect(all.phases.every((entry) => entry.tasks.length === 0)).toBe(true);
	});

	it("view returns the current list without changes", () => {
		const phases = run([], INIT).phases;
		const viewed = run(phases, { op: "view" });
		expect(viewed.phases).toEqual(phases);
	});

	it("reports unknown task and phase targets", () => {
		const phases = run([], INIT).phases;
		expect(run(phases, { op: "done", task: "task-1" }).errors[0]).toContain(
			"not found",
		);
		expect(run(phases, { op: "done", phase: "不存在" }).errors[0]).toContain(
			"not found",
		);
	});

	it("infers a missing op from the payload", () => {
		const init = resolveTodoParams({ list: [{ phase: "A", items: ["x"] }] }, false);
		expect(init?.op).toBe("init");
		const append = resolveTodoParams(
			{ phase: "A", items: ["y"] },
			true,
		);
		expect(append?.op).toBe("append");
		expect(resolveTodoParams({ task: "x" }, true)).toBeNull();
		expect(resolveTodoParams({ op: "nope" }, true)).toBeNull();
	});

	it("summarizes open work and progress for the model", () => {
		const phases = run([], INIT).phases;
		expect(formatTodoResult(phases, [])).toContain("Remaining items (3)");
		expect(formatTodoResult(phases, [])).toContain("Overall: 0/3 done, 3 open.");
		expect(todoProgressLine(phases)).toBe(
			"0/3 completed · in progress: 读源码",
		);
		const done = run(phases, { op: "done" }).phases;
		expect(todoProgressLine(done)).toBeNull();
		expect(formatTodoResult(done, [])).toContain("Remaining items: none.");
	});

	it("reports blocked work separately and drops the note after start", () => {
		const phases = run([], INIT).phases;
		const blocked = run(phases, {
			op: "block",
			task: "跑测试",
			reason: "缺依赖",
		});
		const text = formatTodoResult(blocked.phases, []);
		expect(text).toContain("Overall: 0/3 done, 2 open, 1 blocked.");
		expect(text).toContain("(blocked: 缺依赖)");
		const started = run(blocked.phases, { op: "start", task: "跑测试" });
		expect(started.phases[1]?.tasks[0]).toEqual({
			content: "跑测试",
			status: "in_progress",
		});
		expect(formatTodoResult(started.phases, [])).not.toContain("blocked");
	});
});

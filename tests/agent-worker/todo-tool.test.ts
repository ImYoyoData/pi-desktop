import { afterEach, describe, expect, it } from "vitest";
import {
	clearLatestTodoPhases,
	createTodoToolDefinition,
	getLatestTodoPhases,
	restoreLatestTodoPhases,
	todoPhasesFromSessionEntries,
} from "../../src/agent-worker/todo-tool";

type Result = {
	content: { type: string; text?: string }[];
	details: {
		op: string;
		phases: {
			name: string;
			tasks: { content: string; status: string }[];
		}[];
	};
	isError?: boolean;
};

async function call(
	tool: ReturnType<typeof createTodoToolDefinition>,
	toolCallId: string,
	params: unknown,
): Promise<Result> {
	return (await tool.execute(
		toolCallId,
		params as never,
		undefined,
		undefined,
		{} as never,
	)) as Result;
}

function textOf(result: Result): string {
	return result.content.map((part) => part.text ?? "").join("");
}

const INIT = {
	op: "init",
	list: [{ phase: "实现", items: ["读源码", "改实现"] }],
};

describe("createTodoToolDefinition", () => {
	afterEach(() => {
		clearLatestTodoPhases();
	});

	it("registers the OMP-compatible todo tool", () => {
		const tool = createTodoToolDefinition();
		expect(tool.name).toBe("todo");
	});

	it("init replaces the list and reports every phase", async () => {
		const tool = createTodoToolDefinition();
		const result = await call(tool, "tc-1", INIT);
		expect(result.details.op).toBe("init");
		expect(result.details.phases).toEqual([
			{
				name: "实现",
				tasks: [
					{ content: "读源码", status: "in_progress" },
					{ content: "改实现", status: "pending" },
				],
			},
		]);
		expect(textOf(result)).toContain("Overall: 0/2 done, 2 open.");
		expect(getLatestTodoPhases()).toEqual(result.details.phases);
	});

	it("start and done update the same list", async () => {
		const tool = createTodoToolDefinition();
		await call(tool, "tc-2", INIT);
		const started = await call(tool, "tc-3", { op: "start", task: "改实现" });
		expect(started.details.phases[0]?.tasks[1]?.status).toBe("in_progress");
		const done = await call(tool, "tc-4", { op: "done", task: "读源码" });
		expect(done.details.phases[0]?.tasks[0]?.status).toBe("completed");
	});

	it("keeps the previous list when an operation fails", async () => {
		const tool = createTodoToolDefinition();
		await call(tool, "tc-5", INIT);
		const before = getLatestTodoPhases();
		const failed = await call(tool, "tc-6", { op: "done", task: "不存在" });
		expect(failed.isError).toBe(true);
		expect(textOf(failed)).toContain("not found");
		expect(getLatestTodoPhases()).toEqual(before);
	});

	it("view reads the list without changing it", async () => {
		const tool = createTodoToolDefinition();
		await call(tool, "tc-7", INIT);
		const before = getLatestTodoPhases();
		const viewed = await call(tool, "tc-8", { op: "view" });
		expect(viewed.details.phases).toEqual(before);
		expect(getLatestTodoPhases()).toEqual(before);
	});

	it("infers a missing op from the payload", async () => {
		const tool = createTodoToolDefinition();
		const result = await call(tool, "tc-9", {
			list: [{ phase: "A", items: ["一"] }],
		});
		expect(result.details.op).toBe("init");
		expect(result.isError).toBeUndefined();
	});

	it("rejects unusable arguments", async () => {
		const tool = createTodoToolDefinition();
		await expect(
			call(tool, "tc-10", { op: "nope" }),
		).rejects.toThrow(/invalid arguments/);
	});

	it("restores the latest list from the session branch", () => {
		const phases = [
			{
				name: "实现",
				tasks: [
					{ content: "读源码", status: "completed" as const },
					{ content: "改实现", status: "in_progress" as const },
				],
			},
		];
		const entries = [
			{ type: "message", message: { role: "user" } },
			{
				type: "message",
				message: {
					role: "toolResult",
					toolName: "todo",
					details: { op: "init", phases, storage: "session" },
				},
			},
			{ type: "message", message: { role: "assistant" } },
		];
		expect(todoPhasesFromSessionEntries(entries)).toEqual(phases);
		restoreLatestTodoPhases(entries);
		expect(getLatestTodoPhases()).toEqual(phases);
	});

	it("restores a legacy todo_write list as a single phase", () => {
		const entries = [
			{
				type: "message",
				message: {
					role: "toolResult",
					toolName: "todo_write",
					details: {
						todos: [
							{ id: "1", text: "读源码", status: "completed" },
							{ id: "2", text: "改实现", status: "pending" },
						],
						activeId: "2",
					},
				},
			},
		];
		expect(todoPhasesFromSessionEntries(entries)).toEqual([
			{
				name: "Tasks",
				tasks: [
					{ content: "读源码", status: "completed" },
					{ content: "改实现", status: "in_progress" },
				],
			},
		]);
	});

	it("ignores malformed todo entries and prefers the newest one", () => {
		const entries = [
			{
				type: "message",
				message: {
					role: "toolResult",
					toolName: "todo",
					details: {
						phases: [
							{
								name: "旧",
								tasks: [{ content: "旧任务", status: "pending" }],
							},
						],
					},
				},
			},
			{
				type: "message",
				message: {
					role: "toolResult",
					toolName: "todo",
					details: { phases: [{ name: "坏", tasks: [{ content: "x" }] }] },
				},
			},
			{
				type: "message",
				message: { role: "toolResult", toolName: "read", details: {} },
			},
		];
		expect(todoPhasesFromSessionEntries(entries)).toEqual([
			{ name: "旧", tasks: [{ content: "旧任务", status: "pending" }] },
		]);
		restoreLatestTodoPhases([]);
		expect(getLatestTodoPhases()).toBeNull();
	});
});

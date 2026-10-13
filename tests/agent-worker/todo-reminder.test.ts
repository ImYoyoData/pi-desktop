import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TodoWriteRow } from "../../src/shared/todo-tool";
import { createTodoReminderExtension } from "../../src/agent-worker/todo-reminder";

type ContextBlock = { role?: string; customType?: string; content?: unknown; display?: boolean };

function mount(rows: TodoWriteRow[] | null) {
	const handlers = new Map<string, (event: never) => unknown>();
	const pi = {
		on: (event: string, handler: (event: never) => unknown) => {
			handlers.set(event, handler);
			return () => {};
		},
	} as unknown as ExtensionAPI;
	createTodoReminderExtension(() => rows)(pi);
	const emit = (event: string, payload: unknown): unknown =>
		handlers.get(event)?.(payload as never);
	return { emit, has: (event: string) => handlers.has(event) };
}

function toolEnd(toolName: string): { toolName: string } {
	return { toolName };
}

function contextWith(messages: ContextBlock[]): { messages: ContextBlock[] } {
	return { messages };
}

const OPEN_ROWS: TodoWriteRow[] = [
	{ id: "1", text: "完成 A", status: "completed" },
	{ id: "2", text: "完成 B", status: "in_progress" },
	{ id: "3", text: "完成 C", status: "pending" },
];

describe("todo-reminder extension", () => {
	it("registers the reminder handlers", () => {
		const { has } = mount(OPEN_ROWS);
		expect(has("tool_execution_end")).toBe(true);
		expect(has("context")).toBe(true);
		expect(has("agent_before_settle")).toBe(true);
		expect(has("agent_settled")).toBe(true);
	});

	it("injects a progress note into the context every third tool call", () => {
		const { emit } = mount(OPEN_ROWS);
		// 提前的请求不加料。
		expect(emit("context", contextWith([]))).toBeUndefined();

		emit("tool_execution_end", toolEnd("bash"));
		expect(emit("context", contextWith([]))).toBeUndefined();
		emit("tool_execution_end", toolEnd("read"));
		expect(emit("context", contextWith([]))).toBeUndefined();

		emit("tool_execution_end", toolEnd("edit"));
		const injected = emit("context", contextWith([{ role: "user" }])) as unknown as {
			messages: ContextBlock[];
		};
		expect(injected.messages).toHaveLength(2);
		const note = injected.messages[1];
		expect(note.role).toBe("custom");
		expect(note.customType).toBe("pi-desktop-todo-progress");
		expect(note.display).toBe(false);
		expect(String(note.content)).toContain("1/3 completed");
		expect(String(note.content)).toContain("#2 完成 B");

		// 计数器已归零：接下来的请求不再重复注入。
		expect(emit("context", contextWith([]))).toBeUndefined();
	});

	it("does not annotate tool results themselves", () => {
		const { has } = mount(OPEN_ROWS);
		expect(has("tool_result")).toBe(false);
	});

	it("restarts the count after the model writes the list", () => {
		const { emit } = mount(OPEN_ROWS);
		emit("tool_execution_end", toolEnd("bash"));
		emit("tool_execution_end", toolEnd("read"));
		emit("tool_execution_end", toolEnd("todo_write"));
		emit("tool_execution_end", toolEnd("edit"));
		expect(emit("context", contextWith([]))).toBeUndefined();
	});

	it("stays quiet once every item is completed", () => {
		const done = OPEN_ROWS.map((row) => ({
			...row,
			status: "completed" as const,
		}));
		const { emit } = mount(done);
		emit("tool_execution_end", toolEnd("bash"));
		emit("tool_execution_end", toolEnd("read"));
		emit("tool_execution_end", toolEnd("edit"));
		expect(emit("context", contextWith([]))).toBeUndefined();
		expect(emit("agent_before_settle", { outcome: "completed" })).toBeUndefined();
	});

	it("does nothing when no list was ever written", () => {
		const { emit } = mount(null);
		emit("tool_execution_end", toolEnd("bash"));
		emit("tool_execution_end", toolEnd("read"));
		emit("tool_execution_end", toolEnd("edit"));
		expect(emit("context", contextWith([]))).toBeUndefined();
		expect(emit("agent_before_settle", { outcome: "completed" })).toBeUndefined();
	});

	it("reminds exactly once per run when an in-progress item is left open", () => {
		const { emit } = mount(OPEN_ROWS);
		const first = emit("agent_before_settle", { outcome: "completed" }) as unknown as {
			continue: boolean;
			entries: { customType: string; content: string; display: boolean }[];
		};
		expect(first.continue).toBe(true);
		expect(first.entries).toHaveLength(1);
		expect(first.entries[0].customType).toBe("pi-desktop-todo-progress");
		expect(first.entries[0].display).toBe(false);
		expect(first.entries[0].content).toContain("#2 完成 B");

		// 同一次运行内不再重复提醒（continue 会再走一次边界）。
		expect(emit("agent_before_settle", { outcome: "completed" })).toBeUndefined();

		// settle 后预算重置：下一轮又能提醒。
		emit("agent_settled", { aborted: false });
		expect(emit("agent_before_settle", { outcome: "completed" })).toBeDefined();
	});

	it("ignores nested calls (one codemode script is still one step)", () => {
		const { emit } = mount(OPEN_ROWS);
		for (let i = 0; i < 4; i += 1) {
			emit("tool_execution_end", {
				toolName: "bash",
				parentToolCallId: "call-1",
			});
		}
		expect(emit("context", contextWith([]))).toBeUndefined();

		emit("tool_execution_end", toolEnd("bash"));
		emit("tool_execution_end", toolEnd("read"));
		emit("tool_execution_end", toolEnd("edit"));
		expect(emit("context", contextWith([]))).toBeDefined();
	});

	it("keeps nudging every third tool call instead of firing once", () => {
		const { emit } = mount(OPEN_ROWS);
		for (let i = 0; i < 3; i += 1) emit("tool_execution_end", toolEnd("bash"));
		expect(emit("context", contextWith([]))).toBeDefined();
		for (let i = 0; i < 3; i += 1) emit("tool_execution_end", toolEnd("bash"));
		expect(emit("context", contextWith([]))).toBeDefined();
	});

	it("leaves the reminder without asking to continue when the context cannot run", () => {
		const { emit } = mount(OPEN_ROWS);
		const result = emit("agent_before_settle", {
			outcome: "completed",
			context: { canContinue: false },
		}) as unknown as {
			continue: boolean;
			entries: { customType: string }[];
		};
		expect(result.continue).toBe(false);
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0].customType).toBe("pi-desktop-todo-progress");
	});

	it("does not remind while nothing claims to be in progress", () => {
		const rows: TodoWriteRow[] = [
			{ id: "1", text: "A", status: "completed" },
			{ id: "2", text: "B", status: "pending" },
		];
		const { emit } = mount(rows);
		expect(emit("agent_before_settle", { outcome: "completed" })).toBeUndefined();
	});

	it("does not remind after an aborted or failed run", () => {
		const { emit } = mount(OPEN_ROWS);
		expect(emit("agent_before_settle", { outcome: "aborted" })).toBeUndefined();
		expect(emit("agent_before_settle", { outcome: "error" })).toBeUndefined();
	});
});

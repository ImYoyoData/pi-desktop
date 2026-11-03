import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
	TODO_TOOL_NAME,
	applyTodoParams,
	formatTodoResult,
	isTodoPhaseList,
	resolveTodoParams,
	type TodoPhase,
	type TodoToolDetails,
} from "../shared/todo-tool";

/** 最近一次成功写入的清单 —— 提醒扩展据此把模型拉回进度。 */
let latestPhases: TodoPhase[] = [];

const LEGACY_TODO_TOOL_NAME = "todo_write";

export function getLatestTodoPhases(): TodoPhase[] | null {
	return latestPhases.length ? latestPhases : null;
}

/**
 * 回合切换不再清空清单：清单是会话级状态。
 * 只有历史被改写（编辑 / 回滚）时才主动作废，见 runtime 的 rollback 命令。
 */
export function clearLatestTodoPhases(): void {
	latestPhases = [];
}

function recordOf(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function clonePhases(phases: readonly TodoPhase[]): TodoPhase[] {
	return phases.map((phase) => ({
		name: phase.name,
		tasks: phase.tasks.map((task) =>
			task.blocker === undefined
				? { content: task.content, status: task.status }
				: {
						content: task.content,
						status: task.status,
						blocker: task.blocker,
					},
		),
	}));
}

/** 旧版 todo_write 的展平行；升级前的会话分支里只有这种载荷。 */
function legacyTodoPhases(details: Record<string, unknown>): TodoPhase[] | null {
	const rows = Array.isArray(details.todos) ? details.todos : [];
	const activeId = details.activeId != null ? String(details.activeId) : null;
	const tasks: TodoPhase["tasks"] = [];
	for (const raw of rows) {
		const row = recordOf(raw);
		const content = typeof row?.text === "string" ? row.text.trim() : "";
		if (!content) continue;
		const status =
			row?.status === "completed"
				? "completed"
				: activeId !== null && String(row?.id ?? "") === activeId
					? "in_progress"
					: "pending";
		tasks.push({ content, status });
	}
	return tasks.length ? [{ name: "Tasks", tasks }] : null;
}

/** 会话分支里最后一个 todo 结果的清单；分支被回滚后自然取到保留轮次。 */
export function todoPhasesFromSessionEntries(
	entries: readonly unknown[],
): TodoPhase[] | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = recordOf(entries[i]);
		if (entry?.type !== "message") continue;
		const message = recordOf(entry.message);
		if (message?.role !== "toolResult") continue;
		const details = recordOf(message.details);
		if (!details) continue;
		if (message.toolName === TODO_TOOL_NAME) {
			if (isTodoPhaseList(details.phases)) return clonePhases(details.phases);
			continue;
		}
		if (message.toolName === LEGACY_TODO_TOOL_NAME) {
			const phases = legacyTodoPhases(details);
			if (phases) return phases;
		}
	}
	return null;
}

/** worker 重启 / 空闲销毁后从会话文件恢复清单。 */
export function restoreLatestTodoPhases(entries: readonly unknown[]): void {
	latestPhases = todoPhasesFromSessionEntries(entries) ?? [];
}

const todoSchema = Type.Object(
	{
		op: Type.Optional(
			Type.Union(
				[
					Type.Literal("init"),
					Type.Literal("start"),
					Type.Literal("done"),
					Type.Literal("rm"),
					Type.Literal("drop"),
					Type.Literal("block"),
					Type.Literal("unblock"),
					Type.Literal("append"),
					Type.Literal("view"),
				],
				{
					description:
						"Operation to apply to the current list; inferred from list/items when omitted",
				},
			),
		),
		list: Type.Optional(
			Type.Array(
				Type.Object({
					phase: Type.String({ description: "Phase name" }),
					items: Type.Array(Type.String(), {
						description: "Task texts in this phase",
					}),
				}),
				{ description: "Phases for init" },
			),
		),
		task: Type.Optional(
			Type.String({ description: "Verbatim task content from the current list" }),
		),
		phase: Type.Optional(Type.String({ description: "Phase name" })),
		items: Type.Optional(
			Type.Array(Type.String(), {
				description: "Task texts for a flat init or append",
			}),
		),
		reason: Type.Optional(
			Type.String({ description: "Blocker note for block" }),
		),
	},
	{ additionalProperties: true },
);

/**
 * OMP 同款待办工具：分阶段清单，按任务内容定位，操作与 omp 内置 `todo` 一致。
 *
 * 桌面端两个后端共用这套语义；渲染层读取 `details.phases` 快照。
 * 清单跨轮保留在 worker 内存，重启后由 runtime 从会话分支恢复。
 */
export function createTodoToolDefinition(
	hasSessionFile: () => boolean = () => true,
) {
	return defineTool({
		name: TODO_TOOL_NAME,
		label: "Todo list",
		description:
			'Maintain the session\'s visible todo list. Each call applies ONE operation to the current list: "init" replaces it with list [{ phase, items }]; "start" marks a task in progress (pausing any other in-progress task); "done"/"drop" complete/abandon a task or a phase; "block"/"unblock"; "append" adds items to a phase; "rm" removes a task, clears a phase, or clears everything; "view" reads it. Tasks are addressed by their verbatim content, never by ids.',
		promptSnippet:
			"Maintain a visible todo checklist with init/start/done operations",
		promptGuidelines: [
			'For any multi-step task (>2 steps), call todo with op "init" and list [{ phase, items }] BEFORE starting work.',
			'Mark a task with op "start" before working on it, and op "done" in the same step that finishes it — do not batch completions.',
			'Before your final message of a turn, call todo again if any finished step is still open; the UI never completes items for you.',
			"Tasks are addressed by their exact content from the previous result, never by generated ids.",
			"Exactly ONE task may be in progress at a time; starting another pauses the previous one.",
		],
		executionMode: "sequential",
		parameters: todoSchema,
		async execute(_toolCallId, params) {
			const resolved = resolveTodoParams(params, latestPhases.length > 0);
			if (!resolved) {
				throw new Error(
					"todo: invalid arguments — op must be init/start/done/rm/drop/block/unblock/append/view",
				);
			}
			const result = applyTodoParams(latestPhases, resolved);
			if (!result.errors.length) latestPhases = result.phases;
			const details: TodoToolDetails = {
				op: result.op,
				phases: result.phases,
				storage: hasSessionFile() ? "session" : "memory",
			};
			return {
				content: [
					{
						type: "text" as const,
						text: formatTodoResult(result.phases, result.errors),
					},
				],
				details,
				...(result.errors.length ? { isError: true } : {}),
			};
		},
	});
}

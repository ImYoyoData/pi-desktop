import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
	TODO_WRITE_TOOL_NAME,
	type TodoWriteRow,
	buildTodoWriteDetails,
	normalizeTodoWriteRows,
	summarizeTodoWrite,
} from "../shared/todo-tool";

/** 最近一次模型写入的清单 —— 提醒扩展据此把模型拉回进度。 */
let latestRows: TodoWriteRow[] | null = null;

export function getLatestTodoWriteRows(): TodoWriteRow[] | null {
	return latestRows;
}

/**
 * 新回合开始时作废上一轮的清单。
 *
 * 渲染进程在每次新 prompt / 回滚后都会重置面板，清单的时效就是当前回合；
 * 不清掉的话，新任务开头会把上一轮的进度注入给模型。
 */
export function clearLatestTodoWriteRows(): void {
	latestRows = null;
}

/**
 * Built-in todo list tool (Cursor/Claude-Code style).
 *
 * Every call FULLY REPLACES the visible todo list — there is no hidden
 * persistence, so a new task starts a clean list and completed items never
 * reappear in later tasks. The desktop UI renders the list live with
 * per-item timers and an animated marker on the in-progress row.
 */
const todoWriteSchema = Type.Object(
	{
		todos: Type.Array(
			Type.Object(
				{
					content: Type.Optional(
						Type.String({
							description:
								"Short imperative text for the item (max ~80 chars)",
						}),
					),
					text: Type.Optional(
						Type.String({
							description: "Alias of content — either field works",
						}),
					),
					status: Type.Union([
						Type.Literal("pending"),
						Type.Literal("in_progress"),
						Type.Literal("completed"),
					]),
					id: Type.Optional(
						Type.String({
							description:
								"Stable id so the UI can track each item across updates",
						}),
					),
				},
				{ additionalProperties: true },
			),
			{ minItems: 1 },
		),
	},
	{ additionalProperties: true },
);

export function createTodoWriteToolDefinition() {
	return defineTool({
		name: TODO_WRITE_TOOL_NAME,
		label: "Todo list",
		description:
			"Maintain the session's visible todo checklist. Each call REPLACES the whole list. Use it to plan multi-step work and keep the user informed: exactly one item should be in_progress at a time; mark items completed the moment they finish; never leave a finished step unreported at the end of a turn.",
		promptSnippet:
			"Maintain a visible todo checklist that fully replaces on every call",
		promptGuidelines: [
			"For any multi-step task (>2 steps), create a todo list BEFORE starting work.",
			"Flip an item to in_progress before starting it, and to completed in the same step that finishes it — do not batch completions.",
			"Before your final message of a turn, call todo_write again if any finished step is still open; the UI never completes items for you.",
			"Each call sends the COMPLETE list; omitted items are removed from the UI.",
			"Exactly ONE item may be in_progress at a time; set it before starting that step.",
			"While all items are still pending you may restructure the list freely.",
		],
		executionMode: "sequential",
		parameters: todoWriteSchema,
		async execute(_toolCallId, params) {
			const rows = normalizeTodoWriteRows(
				(params as { todos?: unknown }).todos,
			);
			if (!rows || rows.length === 0) {
				throw new Error("todo_write: no valid todo items");
			}
			latestRows = rows;
			const details = buildTodoWriteDetails(rows);
			const lines = [
				summarizeTodoWrite(rows),
				...rows.map((r) => `- [${r.status}] #${r.id} ${r.text}`),
			];
			if (rows.some((r) => r.status !== "completed")) {
				lines.push(
					"Next: finish the current step, then call todo_write again with the FULL list and mark it completed (never batch completions).",
				);
			}
			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details,
			};
		},
	});
}

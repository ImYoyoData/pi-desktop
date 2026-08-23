import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
	TODO_WRITE_TOOL_NAME,
	buildTodoWriteDetails,
	normalizeTodoWriteRows,
	summarizeTodoWrite,
} from "../shared/todo-tool";

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
			"Maintain the session's visible todo checklist. Each call REPLACES the whole list. Use it to plan multi-step work and keep the user informed: exactly one item should be in_progress at a time; mark items completed as soon as they finish; rewrite freely while items are still pending.",
		promptSnippet:
			"Maintain a visible todo checklist that fully replaces on every call",
		promptGuidelines: [
			"For any multi-step task (>2 steps), create a todo list BEFORE starting work.",
			"Each call sends the COMPLETE list; omitted items are removed from the UI.",
			"Exactly ONE item may be in_progress at a time; set it before starting that step.",
			"Mark an item completed immediately when its work is done — do not batch.",
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
			const details = buildTodoWriteDetails(rows);
			return {
				content: [
					{
						type: "text" as const,
						text: `${summarizeTodoWrite(rows)}\n${rows
							.map((r) => `- [${r.status}] #${r.id} ${r.text}`)
							.join("\n")}`,
					},
				],
				details,
			};
		},
	});
}

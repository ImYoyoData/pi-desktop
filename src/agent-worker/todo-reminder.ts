/**
 * 把「按进度回写待办」从软约束变成机制。
 *
 * 实测模型平均 14~44 次工具调用才回写一次，于是补两条机制：
 * 1. 每 N 次工具调用后，在下一次请求的上下文末尾注入一行进度摘要 ——
 *    模型决策前就能看见剩余步骤，而工具结果与界面完全不受影响；
 * 2. 回合即将结束时仍挂着 in_progress 项（声称在做却没回写）时，
 *    注入一条隐藏提醒并请求继续一次 —— 每轮最多一次，避免循环。
 */
import type {
	ContextEventResult,
	ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import {
	TODO_WRITE_TOOL_NAME,
	type TodoWriteRow,
	todoProgressLine,
} from "../shared/todo-tool";
import { getLatestTodoWriteRows } from "./todo-tool";

/** 每隔几次工具调用注入一次进度（每次都注入会明显抬高上下文体积）。 */
const NOTE_EVERY_RESULTS = 3;

const REMINDER_CUSTOM_TYPE = "pi-desktop-todo-progress";

type ContextMessage = NonNullable<ContextEventResult["messages"]>[number];

function progressMessage(note: string): ContextMessage {
	return {
		role: "custom",
		customType: REMINDER_CUSTOM_TYPE,
		content: `[todos] ${note} — call todo_write with the full list when this step finishes.`,
		display: false,
		timestamp: Date.now(),
	};
}

export function createTodoReminderExtension(
	readRows: () => TodoWriteRow[] | null = getLatestTodoWriteRows,
): ExtensionFactory {
	return (pi) => {
		let resultsSinceNote = 0;
		let remindedThisRun = false;

		pi.on("agent_settled", () => {
			remindedThisRun = false;
		});

		pi.on("tool_execution_end", (event) => {
			// codemode 内的嵌套调用不算一次「模型动手」，否则一次脚本会提前触发提醒。
			if (event.parentToolCallId) return;
			// 模型刚回写过就不再催；计数器同时给上下文注入当节流用。
			resultsSinceNote =
				event.toolName === TODO_WRITE_TOOL_NAME ? 0 : resultsSinceNote + 1;
		});

		pi.on("context", (event) => {
			if (resultsSinceNote < NOTE_EVERY_RESULTS) return;
			const rows = readRows();
			if (!rows) return;
			resultsSinceNote = 0;
			const note = todoProgressLine(rows);
			if (!note) return;
			return { messages: [...event.messages, progressMessage(note)] };
		});

		pi.on("agent_before_settle", (event) => {
			if (remindedThisRun || event.outcome !== "completed") return;
			const rows = readRows();
			if (!rows || !rows.some((row) => row.status === "in_progress")) return;
			remindedThisRun = true;
			const note = todoProgressLine(rows) ?? "unfinished items remain";
			return {
				entries: [
					{
						type: "custom_message" as const,
						customType: REMINDER_CUSTOM_TYPE,
						content:
							`Your todo list still shows an in-progress item you never reported as finished (${note}). ` +
							`Call todo_write now with the FULL list and mark every finished item completed; ` +
							`if the task is not finished, say what is left instead of leaving the list stale.`,
						display: false,
					},
				],
				// 上下文已不可继续时只留下提醒，不请求续跑（否则 SDK 会报无效续跑）。
				continue: event.context?.canContinue !== false,
			};
		});
	};
}

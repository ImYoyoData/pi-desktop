/**
 * Built-in Cursor-style todo_write tool — shared contract between the
 * agent-worker (tool definition) and the renderer (widget rendering).
 *
 * Semantics: EVERY call fully replaces the session's todo list. There is no
 * server-side memory — a new task simply sends a new list, and completed
 * items never resurrect unless the model includes them again.
 */

export const TODO_WRITE_TOOL_NAME = "todo_write";

export type TodoItemStatus = "pending" | "in_progress" | "completed";

export type TodoWriteRow = {
	id: string;
	text: string;
	status: TodoItemStatus;
};

/** Tool result `details` payload consumed by the renderer widget pipeline. */
export type TodoWriteDetails = {
	todos: TodoWriteRow[];
	/** id of the single in_progress row (when any). */
	activeId?: string;
	nowMs: number;
};

function asRecord(v: unknown): Record<string, unknown> | null {
	return v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: null;
}

export function parseTodoStatus(v: unknown): TodoItemStatus {
	const s = typeof v === "string" ? v.trim().toLowerCase() : "";
	if (
		s === "in_progress" ||
		s === "in-progress" ||
		s === "inprogress" ||
		s === "running" ||
		s === "active"
	) {
		return "in_progress";
	}
	if (
		s === "completed" ||
		s === "complete" ||
		s === "done" ||
		s === "finished"
	) {
		return "completed";
	}
	return "pending";
}

/**
 * Normalize heterogeneous todo rows (Cursor `content/status`, plain
 * `text/done`, …) into canonical TodoWriteRow[]. Returns null when nothing
 * usable remains.
 */
export function normalizeTodoWriteRows(rows: unknown): TodoWriteRow[] | null {
	if (!Array.isArray(rows)) return null;
	const out: TodoWriteRow[] = [];
	rows.forEach((raw, index) => {
		const row = asRecord(raw);
		if (!row) return;
		const textRaw =
			(typeof row.content === "string" && row.content) ||
			(typeof row.text === "string" && row.text) ||
			(typeof row.title === "string" && row.title) ||
			"";
		const text = textRaw.trim();
		if (!text) return;
		const idRaw =
			typeof row.id === "string" || typeof row.id === "number"
				? String(row.id)
				: "";
		const id = idRaw.trim() || String(index + 1);
		let status = parseTodoStatus(row.status);
		if (status === "pending" && row.done === true) status = "completed";
		out.push({ id, text, status });
	});
	return out.length ? out : null;
}

/** Build the details payload (renderer derives live timers from this). */
export function buildTodoWriteDetails(
	rows: TodoWriteRow[],
	nowMs: number = Date.now(),
): TodoWriteDetails {
	const active = rows.find((r) => r.status === "in_progress");
	return {
		todos: rows,
		...(active ? { activeId: active.id } : {}),
		nowMs,
	};
}

/** Compact confirmation text returned to the model. */
export function summarizeTodoWrite(rows: TodoWriteRow[]): string {
	const done = rows.filter((r) => r.status === "completed").length;
	const active = rows.filter((r) => r.status === "in_progress").length;
	return `Todo list updated (${rows.length} items · ${done} completed · ${active} in progress).`;
}

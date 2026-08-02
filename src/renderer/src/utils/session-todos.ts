/** Per-session extension widgets (todo / plan progress) for the chat chrome. */

export type SessionTodoItem = {
	id: string;
	text: string;
	done: boolean;
	/** True while the agent is working on this item (⏳ row). */
	active?: boolean;
	/** Elapsed duration in ms (from widget "· 12s" suffix). */
	durationMs?: number;
};

export type SessionTodoList = {
	key: string;
	title: string;
	items: SessionTodoItem[];
	/**
	 * When true, hide a fully-completed list until new incomplete items appear
	 * (Cursor-like: stay visible through completion, dismiss on next task).
	 */
	dismissed: boolean;
};

const TODO_WIDGET_KEYS = new Set([
	"pi-deck-todo",
	"pi-deck-plan-todos",
	"plan-todos",
]);

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Tools that maintain a session todo list (pi-deck `todo`, Cursor-like `todo_write`, …). */
export function isTodoToolName(toolName: string): boolean {
	const n = toolName
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, "_");
	return (
		n === "todo" ||
		n === "todos" ||
		n === "todo_write" ||
		n === "todowrite" ||
		n === "todo_read" ||
		n === "todoread" ||
		n === "todo_update" ||
		n === "write_todos" ||
		n === "update_todos"
	);
}

export function isTodoWidgetKey(key: string): boolean {
	return TODO_WIDGET_KEYS.has(key) || /todo/i.test(key);
}

function stripAnsi(raw: string): string {
	return raw.replace(ANSI_RE, "").trim();
}

function statusDone(status: unknown): boolean {
	if (typeof status !== "string") return false;
	const s = status.trim().toLowerCase();
	return (
		s === "completed" ||
		s === "complete" ||
		s === "done" ||
		s === "closed" ||
		s === "cancelled" ||
		s === "canceled"
	);
}

/** Normalize heterogeneous todo rows (pi-deck text/done, Cursor content/status, …). */
export function normalizeTodoRows(rows: unknown): SessionTodoItem[] {
	if (!Array.isArray(rows)) return [];
	const items: SessionTodoItem[] = [];
	for (const row of rows) {
		if (!row || typeof row !== "object") continue;
		const t = row as {
			id?: unknown;
			text?: unknown;
			content?: unknown;
			title?: unknown;
			done?: unknown;
			completed?: unknown;
			status?: unknown;
			step?: unknown;
			active?: unknown;
			durationMs?: unknown;
		};
		const textRaw =
			(typeof t.text === "string" && t.text) ||
			(typeof t.content === "string" && t.content) ||
			(typeof t.title === "string" && t.title) ||
			"";
		const text = textRaw.trim();
		if (!text) continue;
		const id =
			typeof t.id === "number" || typeof t.id === "string"
				? String(t.id)
				: typeof t.step === "number" || typeof t.step === "string"
					? String(t.step)
					: String(items.length + 1);
		const done = Boolean(t.done ?? t.completed) || statusDone(t.status);
		const active = t.active === true;
		const durationMs =
			typeof t.durationMs === "number" &&
			Number.isFinite(t.durationMs) &&
			t.durationMs >= 0
				? t.durationMs
				: undefined;
		items.push({
			id,
			text,
			done,
			...(active ? { active: true } : {}),
			...(durationMs != null ? { durationMs } : {}),
		});
	}
	return items;
}

/** Parse pi-deck-todo / plan-mode widget lines into a structured list. */
export function parseTodoWidgetLines(
	key: string,
	lines: string[],
): SessionTodoList | null {
	if (!lines.length) return null;
	const items: SessionTodoItem[] = [];
	let title = stripAnsi(lines[0] ?? "") || "Todos";

	for (let i = 0; i < lines.length; i++) {
		const raw = stripAnsi(lines[i] ?? "");
		if (!raw) continue;

		// Header: "待办事项 2/3" | "计划进度 1/4" | "Todos 2/3"
		if (i === 0 && !/^[☑☐✓○⏳\[\]]/.test(raw)) {
			title = raw;
			continue;
		}

		// pi-deck-todo rows: "☑ #1 text" | "⏳ #2 text · 1m 23s" | "☐ #3 text · 12s"
		// 时长后缀可选；⏳ 表示正在进行的项。
		const row = raw.match(/^([☑☐✓○⏳])\s+(?:#(\d+)\s+|(\d+)\.\s+)(.+)$/);
		if (row) {
			const id = row[2] || row[3] || String(items.length + 1);
			const mark = row[1] ?? "";
			const active = mark === "⏳";
			const done = mark === "☑" || mark === "✓";
			// "text · 12s" → strip duration suffix into durationMs
			const { text, durationMs } = splitDurationSuffix(row[4] ?? "");
			items.push({
				id,
				text,
				done,
				...(active ? { active: true } : {}),
				...(durationMs != null ? { durationMs } : {}),
			});
			continue;
		}

		// Markdown-ish: "[x] #1: text" / "[ ] #1: text"
		const md = raw.match(/^\[([ xX])\]\s+#?(\d+):?\s*(.+)$/);
		if (md) {
			items.push({
				id: md[2] ?? String(items.length + 1),
				text: (md[3] ?? "").trim(),
				done: md[1] !== " ",
			});
			continue;
		}

		// Fallback: keep as incomplete line without id prefix
		if (i > 0) {
			items.push({ id: String(items.length + 1), text: raw, done: false });
		}
	}

	if (!items.length) return null;
	return { key, title, items, dismissed: false };
}

/**
 * Split a trailing " · 12s" / " · 1m 23s" duration suffix from todo text.
 * Returns the clean text plus durationMs when present.
 */
export function splitDurationSuffix(raw: string): {
	text: string;
	durationMs: number | null;
} {
	// "text · 12s" | "text · 1m 23s" | "text · 2h 5m" (rare)
	const m = raw.match(
		/^(.*?)\s*·\s*(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?\s*$/,
	);
	if (!m || (!m[2] && !m[3] && !m[4]))
		return { text: raw.trim(), durationMs: null };
	const h = m[2] ? Number(m[2]) : 0;
	const min = m[3] ? Number(m[3]) : 0;
	const sec = m[4] ? Number(m[4]) : 0;
	if (![h, min, sec].every(Number.isFinite))
		return { text: raw.trim(), durationMs: null };
	return {
		text: (m[1] ?? "").trim(),
		durationMs: ((h * 60 + min) * 60 + sec) * 1000,
	};
}

function todosPayloadFromUnknown(details: unknown): {
	action?: unknown;
	rows: unknown;
} | null {
	if (!details || typeof details !== "object") return null;
	const d = details as {
		todos?: unknown;
		tasks?: unknown;
		items?: unknown;
		action?: unknown;
	};
	const rows = d.todos ?? d.tasks ?? d.items;
	if (rows === undefined && d.action === undefined) return null;
	return { action: d.action, rows };
}

/** Build list from todo tool `details` / result payload. */
export function todosFromToolDetails(
	key: string,
	details: unknown,
): SessionTodoList | null {
	const payload = todosPayloadFromUnknown(details);
	if (!payload) return null;

	const items = normalizeTodoRows(payload.rows);
	if (
		payload.action === "clear" ||
		(Array.isArray(payload.rows) && items.length === 0)
	) {
		return null;
	}
	if (!items.length) return null;

	// pi-deck-todo details carry the active id + per-row start/end timestamps
	// at the top level: apply them to the matching rows.
	const detailsObj =
		details && typeof details === "object"
			? (details as { activeId?: unknown; nowMs?: unknown })
			: null;
	const activeId = detailsObj?.activeId;
	const nowMs =
		typeof detailsObj?.nowMs === "number" && Number.isFinite(detailsObj.nowMs)
			? detailsObj.nowMs
			: Date.now();

	for (const item of items) {
		if (activeId != null && String(item.id) === String(activeId)) {
			item.active = true;
		}
		if (item.durationMs != null) continue; // already from widget suffix
		const row = Array.isArray(payload.rows)
			? payload.rows.find(
					(r) =>
						r &&
						typeof r === "object" &&
						String(
							(r as { id?: unknown; step?: unknown }).id ??
								(r as { step?: unknown }).step,
						) === String(item.id),
				)
			: undefined;
		if (!row || typeof row !== "object") continue;
		const rr = row as { startedAt?: unknown; completedAt?: unknown };
		const started =
			typeof rr.startedAt === "number" && Number.isFinite(rr.startedAt)
				? rr.startedAt
				: null;
		const completed =
			typeof rr.completedAt === "number" && Number.isFinite(rr.completedAt)
				? rr.completedAt
				: null;
		if (completed != null && started != null) {
			item.durationMs = Math.max(0, completed - started);
		} else if (started != null && !item.done) {
			item.durationMs = Math.max(0, nowMs - started);
		}
	}

	const doneCount = items.filter((i) => i.done).length;
	return {
		key,
		title: `Todos ${doneCount}/${items.length}`,
		items,
		dismissed: false,
	};
}

/**
 * Build list from tool args while writing (Cursor-like todo_write full replace).
 * Returns null for incremental pi-deck `{ action: "add", text }` calls.
 */
export function todosFromToolArgs(
	key: string,
	args: unknown,
): SessionTodoList | null {
	if (!args || typeof args !== "object") return null;
	const a = args as {
		action?: unknown;
		todos?: unknown;
		tasks?: unknown;
		items?: unknown;
	};
	if (a.action === "clear") return null;
	const rows = a.todos ?? a.tasks ?? a.items;
	if (!Array.isArray(rows)) return null;
	return todosFromToolDetails(key, { action: a.action, todos: rows });
}

export function todoListAllDone(list: SessionTodoList): boolean {
	return list.items.length > 0 && list.items.every((i) => i.done);
}

/**
 * New-task cleanup for stale extension todos.
 *
 * The pi-deck-todo extension keeps its todos in memory per branch and only
 * clears when the LLM explicitly calls `todo clear` — which it often doesn't,
 * so a new task's first setWidget arrives as a superset of the previous
 * round's items. The desktop resets the UI on each new prompt; this function
 * filters out the stale baseline rows so old work never accumulates on top of
 * the new task's list.
 *
 * Returns the visible items plus whether the baseline should be dropped.
 * - If the incoming list contains EVERY baseline text → it's the stale
 *   extension memory; drop those rows and keep only the new additions.
 * - If any baseline text is missing → the agent rebuilt/cleared the list;
 *   keep everything and clear the baseline.
 */
export function filterBaselineItems(
	list: SessionTodoList,
	baselineTexts: Set<string>,
): { items: SessionTodoItem[]; baselineCleared: boolean } {
	if (baselineTexts.size === 0) {
		return { items: list.items, baselineCleared: true };
	}
	const allBaselinePresent = [...baselineTexts].every((base) =>
		list.items.some((i) => i.text.trim() === base),
	);
	if (!allBaselinePresent) {
		return { items: list.items, baselineCleared: true };
	}
	const kept = list.items.filter((i) => !baselineTexts.has(i.text.trim()));
	return { items: kept, baselineCleared: false };
}

export function todoListVisible(
	list: SessionTodoList | null | undefined,
): boolean {
	if (!list || list.items.length === 0) return false;
	// Manually dismissed (or auto-dismissed after completion): hidden until the
	// next setWidget / tool update brings new open items (which resets dismissed).
	if (list.dismissed) return false;
	return true;
}

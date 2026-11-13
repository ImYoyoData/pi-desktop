/** Per-session extension widgets (todo / plan progress) for the chat chrome. */

import { parseTodoPhaseItemBlob } from "../../../shared/todo-tool";

export type SessionTodoItem = {
	id: string;
	text: string;
	done: boolean;
	/** True while the agent is working on this item (⏳ row). */
	active?: boolean;
	/** Elapsed duration in ms (from widget "· 12s" suffix or completed timing). */
	durationMs?: number;
	/** Wall-clock ms when this item started (drives the live in-progress timer). */
	startedAt?: number;
	/**
	 * 回合结束时模型仍没回写这一项（既没标 completed 也没标 in_progress）。
	 * 面板据此显示「未回写」而不是伪造的完成。下一次 todo 更新会清掉它。
	 */
	unreported?: boolean;
	/** 被阻塞的原因，来自 todo details.phases 的 blocker。 */
	blocker?: string;
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
	/**
	 * Set when the user STOPS the agent mid-run: the round did not finish, so
	 * the list freezes in a paused state until the user chooses to continue
	 * (keeps the list for the follow-up prompt) or delete it.
	 */
	paused?: boolean;
};

const TODO_WIDGET_KEYS = new Set([
	"pi-deck-todo",
	"pi-deck-plan-todos",
	"plan-todos",
]);

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Tools that maintain a session todo list (`todo`, legacy `todo_write`, …). */
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
		s === "canceled" ||
		s === "abandoned"
	);
}

/** 行 id：显式 id/step 优先，空值回退到有效行序号。 */
function rowIdFromRaw(
	row: { id?: unknown; step?: unknown },
	positionalId: number,
): string {
	const raw = row.id ?? row.step;
	if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
	if (typeof raw === "string" && raw.trim()) return raw.trim();
	return String(positionalId);
}

/** 行状态为「进行中」，兼容各后端输出的状态词表。 */
function statusActive(status: unknown): boolean {
	if (typeof status !== "string") return false;
	const s = status.trim().toLowerCase();
	return (
		s === "in_progress" ||
		s === "in-progress" ||
		s === "inprogress" ||
		s === "running" ||
		s === "active"
	);
}

/**
 * 从原始行里派生唯一的活动项 id。
 *
 * 模型刚发出 todo 更新时可能只有 args、没有 details.activeId，按行状态能立刻点亮
 * 「进行中」并开始计时，而不是等 tool_execution_end。id/step 缺失时按有效行序号取值，
 * 与 normalizeTodoRows 的兜底 id 一致。
 */
function derivedActiveIdFromRows(rows: unknown): string | null {
	if (!Array.isArray(rows)) return null;
	let index = 0;
	for (const raw of rows) {
		if (!raw || typeof raw !== "object") continue;
		const row = raw as {
			id?: unknown;
			step?: unknown;
			text?: unknown;
			content?: unknown;
			title?: unknown;
			status?: unknown;
		};
		const hasText = [row.text, row.content, row.title].some(
			(v) => typeof v === "string" && v.trim(),
		);
		if (!hasText) continue;
		index += 1;
		if (!statusActive(row.status)) continue;
		return rowIdFromRaw(row, index);
	}
	return null;
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
			unreported?: unknown;
			durationMs?: unknown;
			blocker?: unknown;
		};
		const textRaw =
			(typeof t.text === "string" && t.text) ||
			(typeof t.content === "string" && t.content) ||
			(typeof t.title === "string" && t.title) ||
			"";
		const text = textRaw.trim();
		if (!text) continue;
		const id = rowIdFromRaw(t, items.length + 1);
		const done = Boolean(t.done ?? t.completed) || statusDone(t.status);
		const active = t.active === true;
		const unreported = t.unreported === true;
		const durationMs =
			typeof t.durationMs === "number" &&
			Number.isFinite(t.durationMs) &&
			t.durationMs >= 0
				? t.durationMs
				: undefined;
		const blocker =
			typeof t.blocker === "string" && t.blocker.trim()
				? t.blocker.trim()
				: undefined;
		const blob = parseTodoPhaseItemBlob(text);
		if (blob) {
			// 模型把 init 的阶段条目误放进 items，JSON 兜底把每项串成了一行。
			const blobActive = active || statusActive(t.status);
			blob.items.forEach((nestedText, index) => {
				items.push({
					id: `${id}.${index + 1}`,
					text: nestedText,
					done,
					...(blobActive && index === 0 ? { active: true } : {}),
					...(unreported ? { unreported: true } : {}),
					...(durationMs != null && index === 0 ? { durationMs } : {}),
					...(blocker && index === 0 ? { blocker } : {}),
				});
			});
			continue;
		}
		items.push({
			id,
			text,
			done,
			...(active ? { active: true } : {}),
			...(unreported ? { unreported: true } : {}),
			...(durationMs != null ? { durationMs } : {}),
			...(blocker ? { blocker } : {}),
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

function recordOf(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

/** omp `todo` 的 details：phases[].tasks[] 展平成面板行。 */
function flattenTodoPhases(phases: unknown): unknown[] {
	if (!Array.isArray(phases)) return [];
	const rows: unknown[] = [];
	for (const rawPhase of phases) {
		const tasks = recordOf(rawPhase)?.tasks;
		if (!Array.isArray(tasks)) continue;
		for (const rawTask of tasks) {
			const task = recordOf(rawTask);
			const text = typeof task?.content === "string" ? task.content.trim() : "";
			if (!text) continue;
			const blocker =
				typeof task?.blocker === "string" ? task.blocker.trim() : "";
			rows.push({
				id: String(rows.length + 1),
				text,
				status: typeof task?.status === "string" ? task.status : "pending",
				...(blocker ? { blocker } : {}),
			});
		}
	}
	return rows;
}

/** omp `todo` 的 init 参数：list[].items[] 展平；首项与 omp 一样标为进行中。 */
function flattenTodoInitList(list: unknown): unknown[] | null {
	if (!Array.isArray(list)) return null;
	const rows: unknown[] = [];
	for (const rawPhase of list) {
		const items = recordOf(rawPhase)?.items;
		if (!Array.isArray(items)) continue;
		for (const item of items) {
			const text = typeof item === "string" ? item.trim() : "";
			if (!text) continue;
			rows.push({
				id: String(rows.length + 1),
				text,
				status: rows.length === 0 ? "in_progress" : "pending",
			});
		}
	}
	return rows.length ? rows : null;
}

function todosPayloadFromUnknown(details: unknown): {
	action?: unknown;
	rows: unknown;
} | null {
	const d = recordOf(details);
	if (!d) return null;
	if (Array.isArray(d.phases)) {
		const rows = flattenTodoPhases(d.phases);
		return {
			action: typeof d.op === "string" ? d.op : rows.length ? undefined : "clear",
			rows,
		};
	}
	const rows = d.todos ?? d.tasks ?? d.items;
	const action = d.action ?? d.op;
	if (rows === undefined && action === undefined) return null;
	return { action, rows };
}

/** 工具载荷里的动作（Cursor action / omp op）。 */
export function todoActionFromPayload(details: unknown): unknown {
	return todosPayloadFromUnknown(details)?.action;
}

/** 载荷是否代表“列表已空”：omp 的空 phases 快照，或 Cursor 的 clear 动作。 */
export function todoPayloadEmptiesList(details: unknown): boolean {
	const d = recordOf(details);
	if (!d) return false;
	if (Array.isArray(d.phases)) return flattenTodoPhases(d.phases).length === 0;
	return d.action === "clear";
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
	const activeKey =
		activeId != null ? String(activeId) : derivedActiveIdFromRows(payload.rows);
	const nowMs =
		typeof detailsObj?.nowMs === "number" && Number.isFinite(detailsObj.nowMs)
			? detailsObj.nowMs
			: Date.now();

	for (const item of items) {
		if (activeKey != null && String(item.id) === activeKey) {
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
 * Build list from tool args while writing: todo init 的 list/items 与 Cursor 风格的
 * 全量 todos 都算完整清单；增量 add/toggle 返回 null。
 */
export function todosFromToolArgs(
	key: string,
	args: unknown,
): SessionTodoList | null {
	const a = recordOf(args);
	if (!a) return null;
	const action = a.action ?? a.op;
	if (action === "clear") return null;
	if (a.op === "init") {
		const rows = flattenTodoInitList(a.list);
		if (rows) return todosFromToolDetails(key, { action: "init", todos: rows });
	}
	const rows = a.todos ?? a.tasks ?? a.items;
	if (!Array.isArray(rows)) return null;
	return todosFromToolDetails(key, { action, todos: rows });
}

/**
 * omp todo 单次操作涉及的条目。
 *
 * 增量操作（done/start/append 等）没有全量快照，只有这次动过的条目；
 * 没有它们，卡片只剩一个动作标题，点开也没有内容可看。
 */
export function todoItemsFromToolArgs(args: unknown): SessionTodoItem[] {
	const a = recordOf(args);
	if (!a) return [];
	const op =
		typeof a.op === "string"
			? a.op
			: typeof a.action === "string"
				? a.action
				: "";
	const single = typeof a.task === "string" ? a.task.trim() : "";
	const many = Array.isArray(a.items)
		? a.items
				.filter((value): value is string => typeof value === "string")
				.map((value) => value.trim())
				.filter(Boolean)
		: [];
	if (
		op === "done" ||
		op === "start" ||
		op === "block" ||
		op === "unblock" ||
		op === "rm"
	) {
		return single ? [{ id: "1", text: single, done: op === "done" }] : [];
	}
	if (op === "append" || op === "add") {
		return many.map((text, index) => ({
			id: String(index + 1),
			text,
			done: false,
		}));
	}
	return [];
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

export type TodoListSnapshot = {
	version: 1;
	sessionId: string;
	savedAt: number;
	list: SessionTodoList;
	startedAt: number;
	completedAt: number;
	toolOwned: boolean;
	timings: Record<string, { startedAt: number; completedAt?: number }>;
};

const TODO_SNAPSHOT_VERSION = 1;

export function todoSnapshotKey(sessionId: string): string {
	return `pi-desktop:todo-snapshot:v1:${sessionId}`;
}

export function serializeTodoSnapshot(
	sessionId: string,
	list: SessionTodoList,
	startedAt: number,
	completedAt: number,
	toolOwned: boolean,
	timings: Record<string, { startedAt: number; completedAt?: number }>,
): TodoListSnapshot {
	return {
		version: TODO_SNAPSHOT_VERSION,
		sessionId,
		savedAt: Date.now(),
		list: { ...list, items: list.items.map((item) => ({ ...item })) },
		startedAt,
		completedAt,
		toolOwned,
		timings: Object.fromEntries(
			Object.entries(timings ?? {}).map(([key, value]) => [key, { ...value }]),
		),
	};
}

export function parseTodoSnapshot(raw: unknown): TodoListSnapshot | null {
	if (!raw || typeof raw !== "object") return null;
	const s = raw as Partial<TodoListSnapshot> & { list?: unknown };
	if (s.version !== TODO_SNAPSHOT_VERSION) return null;
	if (typeof s.sessionId !== "string" || !s.sessionId) return null;
	const list = s.list as Partial<SessionTodoList> | null | undefined;
	if (!list || !Array.isArray(list.items) || !list.items.length) return null;
	const items = normalizeTodoRows(list.items);
	if (!items.length) return null;
	for (const item of items) {
		const src = list.items.find(
			(r) => r && typeof r === "object" && String((r as { text?: unknown }).text ?? "").trim() === item.text,
		) as { startedAt?: unknown; durationMs?: unknown } | undefined;
		const startedAt =
			typeof src?.startedAt === "number" && Number.isFinite(src.startedAt) ? src.startedAt : undefined;
		const durationMs =
			typeof src?.durationMs === "number" && Number.isFinite(src.durationMs) && src.durationMs >= 0
				? src.durationMs
				: undefined;
		if (startedAt != null) item.startedAt = startedAt;
		if (durationMs != null) item.durationMs = durationMs;
	}
	return {
		version: 1,
		sessionId: s.sessionId,
		savedAt: typeof s.savedAt === "number" ? s.savedAt : 0,
		list: {
			key: typeof list.key === "string" ? list.key : "pi-deck-todo",
			title: typeof list.title === "string" ? list.title : "Todos",
			items,
			dismissed: list.dismissed === true,
			...(list.paused === true ? { paused: true as const } : {}),
		},
		startedAt: typeof s.startedAt === "number" ? s.startedAt : 0,
		completedAt: typeof s.completedAt === "number" ? s.completedAt : 0,
		toolOwned: s.toolOwned === true,
		timings:
			s.timings && typeof s.timings === "object" && !Array.isArray(s.timings)
				? (s.timings as TodoListSnapshot["timings"])
				: {},
	};
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

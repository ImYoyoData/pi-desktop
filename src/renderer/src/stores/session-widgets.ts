import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useSessionsStore } from "./sessions";
import {
	isTodoWidgetKey,
	parseTodoWidgetLines,
	todoListAllDone,
	todoListVisible,
	todosFromToolArgs,
	todosFromToolDetails,
	type SessionTodoList,
} from "../utils/session-todos";

/**
 * Live extension widgets / todo lists keyed by session.
 * Fed by `ctx.ui.setWidget` and todo tool results.
 *
 * Todo semantics (full replace): every non-empty update REPLACES the
 * session's list — no merging with previous rounds. Once the built-in
 * `todo_write` tool has written a list, extension widget pushes are ignored
 * until the next new-task reset, so stale extension memory can never bleed
 * old items back in.
 */
export const useSessionWidgetsStore = defineStore("session-widgets", () => {
	/** sessionId → widgetKey → raw lines (null = cleared) */
	const widgetsBySession = ref<Record<string, Record<string, string[]>>>({});
	/** sessionId → structured todo list (primary UI) */
	const todosBySession = ref<Record<string, SessionTodoList | null>>({});
	/** sessionId → wall-clock ms when the current todo round started (auto).
	 *  Set when the first non-empty todo list appears; cleared on reset. */
	const todoStartedAtBySession = ref<Record<string, number>>({});
	/** sessionId → wall-clock ms when the round finished (all items done). */
	const todoCompletedAtBySession = ref<Record<string, number>>({});
	/** sessionId → itemKey → per-item timing (startedAt / completedAt).
	 *  Keyed by trimmed item TEXT so timers survive id renumbering but never
	 *  attach to a different task's items. */
	const itemTimingBySession = ref<
		Record<string, Record<string, { startedAt: number; completedAt?: number }>>
	>({});
	/** Sessions where the built-in todo_write tool owns the list — extension
	 *  widget pushes are ignored there until the next new-task reset. */
	const toolOwnedBySession = ref<Record<string, boolean>>({});
	/**
	 * Sessions whose NEXT reset is user-intentional ("continue task"): the
	 * paused list must survive the follow-up prompt instead of being wiped.
	 */
	const skipNextResetBySession = ref<Record<string, boolean>>({});

	const sessions = useSessionsStore();

	const activeTodoList = computed(() => {
		const id = sessions.activeId;
		if (!id) return null;
		const list = todosBySession.value[id];
		return todoListVisible(list) ? list : null;
	});

	/** Wall-clock start of the current todo round (0 when none). */
	function todoStartedAt(sessionId: string): number {
		return todoStartedAtBySession.value[sessionId] ?? 0;
	}

	/** Wall-clock end of the current todo round (0 while still in progress). */
	function todoCompletedAt(sessionId: string): number {
		return todoCompletedAtBySession.value[sessionId] ?? 0;
	}

	/** Arm the round clock on the first non-empty list for the session. */
	function ensureTodoClock(sessionId: string, hasItems: boolean): void {
		if (!hasItems) return;
		if (!todoStartedAtBySession.value[sessionId]) {
			todoStartedAtBySession.value = {
				...todoStartedAtBySession.value,
				[sessionId]: Date.now(),
			};
		}
	}

	function ensureSessionWidgets(sessionId: string): Record<string, string[]> {
		const cur = widgetsBySession.value[sessionId];
		if (cur) return cur;
		const next: Record<string, string[]> = {};
		widgetsBySession.value = { ...widgetsBySession.value, [sessionId]: next };
		return next;
	}

	function setWidget(
		sessionId: string,
		widgetKey: string,
		widgetLines: string[] | null,
	): void {
		if (isTodoWidgetKey(widgetKey)) {
			// The builtin tool owns this session's list — ignore stale
			// extension re-pushes so old rows never resurface.
			if (toolOwnedBySession.value[sessionId]) return;
		}
		const map = { ...ensureSessionWidgets(sessionId) };
		if (!widgetLines || widgetLines.length === 0) {
			delete map[widgetKey];
			widgetsBySession.value = { ...widgetsBySession.value, [sessionId]: map };
			if (isTodoWidgetKey(widgetKey)) {
				todosBySession.value = { ...todosBySession.value, [sessionId]: null };
			}
			return;
		}

		map[widgetKey] = widgetLines;
		widgetsBySession.value = { ...widgetsBySession.value, [sessionId]: map };

		if (isTodoWidgetKey(widgetKey)) {
			const parsed = parseTodoWidgetLines(widgetKey, widgetLines);
			if (parsed) {
				applyTodoList(sessionId, parsed);
			}
		}
	}

	function applyTodoToolResult(sessionId: string, details: unknown): void {
		const list = todosFromToolDetails("pi-deck-todo", details);
		if (list) toolOwnedBySession.value = { ...toolOwnedBySession.value, [sessionId]: true };
		applyTodoList(sessionId, list, details);
	}

	/** Prefer full-list args (todo_write); ignore incremental add/toggle-only args. */
	function applyTodoToolArgs(sessionId: string, args: unknown): void {
		const list = todosFromToolArgs("pi-deck-todo", args);
		if (!list) return;
		toolOwnedBySession.value = { ...toolOwnedBySession.value, [sessionId]: true };
		applyTodoList(sessionId, list, args);
	}

	/**
	 * FULL REPLACE: the incoming list becomes the entire visible list.
	 * Per-item timers key off trimmed text — same text keeps/continues its
	 * timer across updates; anything new starts fresh; removed items are
	 * pruned so completed work never leaks into the next task's list.
	 */
	function applyTodoList(
		sessionId: string,
		list: SessionTodoList | null,
		raw?: unknown,
	): void {
		if (!list) {
			if (
				raw &&
				typeof raw === "object" &&
				(raw as { action?: string }).action === "clear"
			) {
				todosBySession.value = { ...todosBySession.value, [sessionId]: null };
			}
			return;
		}
		const items = list.items;
		const hasOpen = items.some((i) => !i.done);
		ensureTodoClock(sessionId, items.length > 0);

		// Per-item timing: arm a start clock on first sight of an open item,
		// freeze its duration the moment it flips to done, and stop the round
		// clock once every item is complete.
		const now = Date.now();
		const timing = itemTimingBySession.value[sessionId] ?? {};
		const nextTiming: typeof timing = {};
		for (const item of items) {
			const key = item.text.trim();
			const t = timing[key];
			if (item.done) {
				if (t && !t.completedAt && item.durationMs == null) {
					item.durationMs = Math.max(0, now - t.startedAt);
				}
				item.startedAt = undefined;
				nextTiming[key] = t
					? { startedAt: t.startedAt, completedAt: t.completedAt ?? now }
					: { startedAt: now - (item.durationMs ?? 0), completedAt: now };
			} else if (t && !t.completedAt) {
				// Still open and running — continue its clock.
				item.startedAt = t.startedAt;
				nextTiming[key] = t;
			} else {
				// Fresh open item (new text, or reopened after completion).
				item.startedAt = now;
				nextTiming[key] = { startedAt: now };
			}
		}
		itemTimingBySession.value = {
			...itemTimingBySession.value,
			[sessionId]: nextTiming,
		};

		const allDone = items.length > 0 && !hasOpen;
		if (allDone && !todoCompletedAtBySession.value[sessionId]) {
			todoCompletedAtBySession.value = {
				...todoCompletedAtBySession.value,
				[sessionId]: now,
			};
		} else if (!allDone) {
			const ends = { ...todoCompletedAtBySession.value };
			delete ends[sessionId];
			todoCompletedAtBySession.value = ends;
		}

		// Full replace — dismissed only persists while the list stays all-done.
		todosBySession.value = {
			...todosBySession.value,
			[sessionId]: {
				...list,
				items,
				dismissed: hasOpen ? false : Boolean(todosBySession.value[sessionId]?.dismissed),
				// Fresh activity un-pauses a stopped round.
				paused: hasOpen ? false : todosBySession.value[sessionId]?.paused,
			},
		};
	}

	/**
	 * User STOPPED the agent mid-run. Freeze the round as "paused" — items
	 * stay open, timers hold their value, and nothing is auto-completed.
	 * The user then chooses to continue or delete from the panel.
	 */
	function pauseTodosForSession(sessionId: string): void {
		const list = todosBySession.value[sessionId];
		if (!list || todoListAllDone(list)) return;
		todosBySession.value = {
			...todosBySession.value,
			[sessionId]: { ...list, paused: true },
		};
	}

	/**
	 * User chose CONTINUE on a paused list: un-pause and let the list
	 * survive the next prompt's new-task reset (consumed once).
	 */
	function resumeTodosForSession(sessionId: string): void {
		const list = todosBySession.value[sessionId];
		if (!list) return;
		skipNextResetBySession.value = {
			...skipNextResetBySession.value,
			[sessionId]: true,
		};
		todosBySession.value = {
			...todosBySession.value,
			[sessionId]: { ...list, paused: false },
		};
	}

	/** User chose DELETE on a paused list: drop it entirely. */
	function deleteTodoList(sessionId: string): void {
		const next = { ...todosBySession.value };
		delete next[sessionId];
		todosBySession.value = next;
		const clocks = { ...todoStartedAtBySession.value };
		delete clocks[sessionId];
		todoStartedAtBySession.value = clocks;
		const ends = { ...todoCompletedAtBySession.value };
		delete ends[sessionId];
		todoCompletedAtBySession.value = ends;
		const timings = { ...itemTimingBySession.value };
		delete timings[sessionId];
		itemTimingBySession.value = timings;
		const owned = { ...toolOwnedBySession.value };
		delete owned[sessionId];
		toolOwnedBySession.value = owned;
	}

	/**
	 * Turn finished: auto-complete any items the model left open so the
	 * round always ends with a closed checklist and a frozen total time.
	 * (Models routinely forget to flip the last item to completed.)
	 */
	function finalizeTodosForSession(sessionId: string): void {
		const list = todosBySession.value[sessionId];
		// Paused = user stopped this round on purpose — never auto-complete it.
		if (!list || list.paused) return;
		const now = Date.now();
		const timing = { ...(itemTimingBySession.value[sessionId] ?? {}) };
		let changed = false;
		const items = list.items.map((item) => {
			if (item.done) return item;
			changed = true;
			const key = item.text.trim();
			const t = timing[key];
			const startedAt = item.startedAt ?? t?.startedAt ?? now;
			timing[key] = { startedAt, completedAt: now };
			const { active: _active, startedAt: _startedAt, ...rest } = item;
			return { ...rest, done: true, durationMs: Math.max(0, now - startedAt) };
		});
		if (!changed) {
			// Already all done — just make sure the round clock is closed.
			if (!todoCompletedAtBySession.value[sessionId]) {
				todoCompletedAtBySession.value = {
					...todoCompletedAtBySession.value,
					[sessionId]: now,
				};
			}
			return;
		}
		itemTimingBySession.value = {
			...itemTimingBySession.value,
			[sessionId]: timing,
		};
		todoCompletedAtBySession.value = {
			...todoCompletedAtBySession.value,
			[sessionId]: now,
		};
		todosBySession.value = {
			...todosBySession.value,
			[sessionId]: { ...list, items, dismissed: false },
		};
	}

	/**
	 * Reset the todo widget when a new task/turn starts. The UI list is
	 * dropped entirely and the builtin-tool ownership flag clears, so the
	 * next round's list (from any source) shows only that round's items.
	 */
	function resetTodosForSession(sessionId: string): void {
		// "Continue task" armed by resumeTodosForSession — keep the list for
		// the follow-up prompt (the agent's next todo_write replaces it).
		if (skipNextResetBySession.value[sessionId]) {
			const skip = { ...skipNextResetBySession.value };
			delete skip[sessionId];
			skipNextResetBySession.value = skip;
			return;
		}
		const next = { ...todosBySession.value };
		delete next[sessionId];
		todosBySession.value = next;
		const clocks = { ...todoStartedAtBySession.value };
		delete clocks[sessionId];
		todoStartedAtBySession.value = clocks;
		const ends = { ...todoCompletedAtBySession.value };
		delete ends[sessionId];
		todoCompletedAtBySession.value = ends;
		const timings = { ...itemTimingBySession.value };
		delete timings[sessionId];
		itemTimingBySession.value = timings;
		const owned = { ...toolOwnedBySession.value };
		delete owned[sessionId];
		toolOwnedBySession.value = owned;
		const skips = { ...skipNextResetBySession.value };
		delete skips[sessionId];
		skipNextResetBySession.value = skips;
		const widgets = { ...widgetsBySession.value };
		const row = widgets[sessionId];
		if (row) {
			const cleaned: Record<string, string[]> = {};
			for (const [k, v] of Object.entries(row)) {
				if (!isTodoWidgetKey(k)) cleaned[k] = v;
			}
			widgets[sessionId] = cleaned;
			widgetsBySession.value = widgets;
		}
	}

	/** Hide the todo panel for this session (re-shows when new open items arrive). */
	function dismissTodoList(sessionId: string): void {
		const list = todosBySession.value[sessionId];
		if (!list) return;
		todosBySession.value = {
			...todosBySession.value,
			[sessionId]: { ...list, dismissed: true },
		};
	}

	/** Hide completed list when the user starts the next task. */
	function dismissCompletedOnNewTask(sessionId: string): void {
		const list = todosBySession.value[sessionId];
		if (!list || !todoListAllDone(list)) return;
		todosBySession.value = {
			...todosBySession.value,
			[sessionId]: { ...list, dismissed: true },
		};
	}

	function clearSession(sessionId: string): void {
		const { [sessionId]: _w, ...restW } = widgetsBySession.value;
		const { [sessionId]: _t, ...restT } = todosBySession.value;
		const { [sessionId]: _c, ...restC } = todoStartedAtBySession.value;
		const { [sessionId]: _e, ...restE } = todoCompletedAtBySession.value;
		const { [sessionId]: _o, ...restO } = toolOwnedBySession.value;
		const { [sessionId]: _m, ...restM } = itemTimingBySession.value;
		widgetsBySession.value = restW;
		todosBySession.value = restT;
		todoStartedAtBySession.value = restC;
		todoCompletedAtBySession.value = restE;
		toolOwnedBySession.value = restO;
		itemTimingBySession.value = restM;
	}

	return {
		widgetsBySession,
		todosBySession,
		activeTodoList,
		todoStartedAt,
		todoCompletedAt,
		setWidget,
		applyTodoToolResult,
		applyTodoToolArgs,
		finalizeTodosForSession,
		pauseTodosForSession,
		resumeTodosForSession,
		deleteTodoList,
		dismissCompletedOnNewTask,
		dismissTodoList,
		resetTodosForSession,
		clearSession,
	};
});

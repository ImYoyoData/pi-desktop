import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useSessionsStore } from "./sessions";
import {
	filterBaselineItems,
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
 */
export const useSessionWidgetsStore = defineStore("session-widgets", () => {
	/** sessionId → widgetKey → raw lines (null = cleared) */
	const widgetsBySession = ref<Record<string, Record<string, string[]>>>({});
	/** sessionId → structured todo list (primary UI) */
	const todosBySession = ref<Record<string, SessionTodoList | null>>({});
	/** sessionId → wall-clock ms when the current todo round started (auto).
	 *  Set when the first non-empty todo list appears; cleared on reset. */
	const todoStartedAtBySession = ref<Record<string, number>>({});
	/**
	 * sessionId → baseline item texts captured at reset time. While a baseline
	 * is armed, incoming todo lists are filtered so stale extension items from
	 * the previous round never accumulate on top of the new task's list.
	 */
	const baselineBySession = ref<Record<string, Set<string>>>({});

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
				applyTodoList(sessionId, parsed, null);
			}
		}
	}

	function applyTodoToolResult(sessionId: string, details: unknown): void {
		applyTodoList(
			sessionId,
			todosFromToolDetails("pi-deck-todo", details),
			details,
		);
	}

	/** Prefer full-list args (todo_write); ignore incremental add/toggle-only args. */
	function applyTodoToolArgs(sessionId: string, args: unknown): void {
		const list = todosFromToolArgs("pi-deck-todo", args);
		if (!list) return;
		applyTodoList(sessionId, list, args);
	}

	function applyTodoList(
		sessionId: string,
		list: SessionTodoList | null,
		raw: unknown,
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
		const baseline = baselineBySession.value[sessionId];
		let items = list.items;
		let baselineCleared = true;
		if (baseline && baseline.size > 0) {
			const r = filterBaselineItems(list, baseline);
			items = r.items;
			baselineCleared = r.baselineCleared;
		}
		// Keep dismissing only while still all-done; incomplete work re-shows.
		const prev = todosBySession.value[sessionId];
		const hasOpen = items.some((i) => !i.done);
		ensureTodoClock(sessionId, items.length > 0);
		todosBySession.value = {
			...todosBySession.value,
			[sessionId]: {
				...list,
				items,
				dismissed: hasOpen ? false : Boolean(prev?.dismissed),
			},
		};
		if (baselineCleared) {
			const next = { ...baselineBySession.value };
			delete next[sessionId];
			baselineBySession.value = next;
		}
	}

	/**
	 * Reset the todo widget when a new task/turn starts, so the previous
	 * round's items never accumulate on top of the next round's list. Records
	 * the old items as a baseline so stale extension re-pushes get filtered.
	 */
	function resetTodosForSession(sessionId: string): void {
		const old = todosBySession.value[sessionId];
		if (old && old.items.length > 0) {
			baselineBySession.value = {
				...baselineBySession.value,
				[sessionId]: new Set(old.items.map((i) => i.text.trim())),
			};
		}
		const next = { ...todosBySession.value };
		delete next[sessionId];
		todosBySession.value = next;
		const clocks = { ...todoStartedAtBySession.value };
		delete clocks[sessionId];
		todoStartedAtBySession.value = clocks;
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
		const { [sessionId]: _b, ...restB } = baselineBySession.value;
		widgetsBySession.value = restW;
		todosBySession.value = restT;
		todoStartedAtBySession.value = restC;
		baselineBySession.value = restB;
	}

	return {
		widgetsBySession,
		todosBySession,
		activeTodoList,
		todoStartedAt,
		setWidget,
		applyTodoToolResult,
		applyTodoToolArgs,
		dismissCompletedOnNewTask,
		dismissTodoList,
		resetTodosForSession,
		clearSession,
	};
});

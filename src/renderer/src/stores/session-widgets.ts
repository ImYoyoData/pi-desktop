import { create } from "zustand";
import { useSessionsStore } from "./sessions";
import {
	isTodoWidgetKey,
	parseTodoSnapshot,
	parseTodoWidgetLines,
	serializeTodoSnapshot,
	todoListAllDone,
	todoListVisible,
	todoSnapshotKey,
	todosFromToolArgs,
	todosFromToolDetails,
	type SessionTodoList,
} from "../utils/session-todos";
import * as prefs from "@renderer/utils/prefs";

type WidgetsBase = {
	/** sessionId → widgetKey → raw lines (null = cleared) */
	widgetsBySession: Record<string, Record<string, string[]>>;
	/** sessionId → structured todo list (primary UI) */
	todosBySession: Record<string, SessionTodoList | null>;
	/** sessionId → wall-clock ms when the current todo round started (auto).
	 *  Set when the first non-empty todo list appears; cleared on reset. */
	todoStartedAtBySession: Record<string, number>;
	/** sessionId → wall-clock ms when the round finished (all items done). */
	todoCompletedAtBySession: Record<string, number>;
	/** sessionId → itemKey → per-item timing (startedAt / completedAt).
	 *  Keyed by trimmed item TEXT so timers survive id renumbering but never
	 *  attach to a different task's items. */
	itemTimingBySession: Record<
		string,
		Record<string, { startedAt: number; completedAt?: number }>
	>;
	/** Sessions where the built-in todo_write tool owns the list — extension
	 *  widget pushes are ignored there until the next new-task reset. */
	toolOwnedBySession: Record<string, boolean>;
	/**
	 * Sessions whose NEXT reset is user-intentional ("continue task"): the
	 * paused list must survive the follow-up prompt instead of being wiped.
	 */
	skipNextResetBySession: Record<string, boolean>;
};

type WidgetsDerived = {
	activeTodoList: SessionTodoList | null;
};

export type SessionWidgetsState = WidgetsBase &
	WidgetsDerived & {
		todoStartedAt: (sessionId: string) => number;
		todoCompletedAt: (sessionId: string) => number;
		setWidget: (
			sessionId: string,
			widgetKey: string,
			widgetLines: string[] | null,
		) => void;
		applyTodoToolResult: (sessionId: string, details: unknown) => void;
		applyTodoToolArgs: (sessionId: string, args: unknown) => void;
		finalizeTodosForSession: (sessionId: string) => void;
		pauseTodosForSession: (sessionId: string) => void;
		resumeTodosForSession: (sessionId: string) => void;
		deleteTodoList: (sessionId: string) => void;
		dismissCompletedOnNewTask: (sessionId: string) => void;
		dismissTodoList: (sessionId: string) => void;
		resetTodosForSession: (sessionId: string) => void;
		restoreTodoSnapshots: () => void;
		pruneStaleTodoSnapshots: (knownSessionIds: Set<string>) => void;
		clearSession: (sessionId: string) => void;
	};

function derive(base: WidgetsBase): WidgetsDerived {
	const id = useSessionsStore.getState().activeId;
	const list = id ? base.todosBySession[id] : undefined;
	return {
		activeTodoList: list && todoListVisible(list) ? list : null,
	};
}

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
export const useSessionWidgetsStore = create<SessionWidgetsState>()(
	(set, get) => {
		const base: WidgetsBase = {
			widgetsBySession: {},
			todosBySession: {},
			todoStartedAtBySession: {},
			todoCompletedAtBySession: {},
			itemTimingBySession: {},
			toolOwnedBySession: {},
			skipNextResetBySession: {},
		};

		let todoSnapshotRestored = false;

		function commit(patch: Partial<WidgetsBase>): void {
			set((state) => {
				const next = { ...state, ...patch };
				return { ...next, ...derive(next) };
			});
		}

		/** Wall-clock start of the current todo round (0 when none). */
		function todoStartedAt(sessionId: string): number {
			return get().todoStartedAtBySession[sessionId] ?? 0;
		}

		/** Wall-clock end of the current todo round (0 while still in progress). */
		function todoCompletedAt(sessionId: string): number {
			return get().todoCompletedAtBySession[sessionId] ?? 0;
		}

		function setWidget(
			sessionId: string,
			widgetKey: string,
			widgetLines: string[] | null,
		): void {
			const state = get();
			if (isTodoWidgetKey(widgetKey)) {
				// The builtin tool owns this session's list — ignore stale
				// extension re-pushes so old rows never resurface.
				if (state.toolOwnedBySession[sessionId]) return;
			}
			const map = { ...(state.widgetsBySession[sessionId] ?? {}) };
			if (!widgetLines || widgetLines.length === 0) {
				const patch: Partial<WidgetsBase> = {
					widgetsBySession: {
						...state.widgetsBySession,
						[sessionId]: map,
					},
				};
				if (isTodoWidgetKey(widgetKey)) {
					patch.todosBySession = {
						...state.todosBySession,
						[sessionId]: null,
					};
				}
				commit(patch);
				return;
			}

			map[widgetKey] = widgetLines;
			commit({
				widgetsBySession: { ...state.widgetsBySession, [sessionId]: map },
			});

			if (isTodoWidgetKey(widgetKey)) {
				const parsed = parseTodoWidgetLines(widgetKey, widgetLines);
				if (parsed) {
					applyTodoList(sessionId, parsed);
				}
			}
		}

		function applyTodoToolResult(sessionId: string, details: unknown): void {
			const list = todosFromToolDetails("pi-deck-todo", details);
			if (list) {
				commit({
					toolOwnedBySession: {
						...get().toolOwnedBySession,
						[sessionId]: true,
					},
				});
			}
			applyTodoList(sessionId, list, details);
		}

		/** Prefer full-list args (todo_write); ignore incremental add/toggle-only args. */
		function applyTodoToolArgs(sessionId: string, args: unknown): void {
			const list = todosFromToolArgs("pi-deck-todo", args);
			if (!list) return;
			commit({
				toolOwnedBySession: {
					...get().toolOwnedBySession,
					[sessionId]: true,
				},
			});
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
			const state = get();
			if (!list) {
				if (
					raw &&
					typeof raw === "object" &&
					(raw as { action?: string }).action === "clear"
				) {
					commit({
						todosBySession: { ...state.todosBySession, [sessionId]: null },
					});
				}
				return;
			}
			const items = list.items;
			const hasOpen = items.some((i) => !i.done);

			// Per-item timing: arm a start clock on first sight of an open item,
			// freeze its duration the moment it flips to done, and stop the round
			// clock once every item is complete.
			const now = Date.now();
			const timing = state.itemTimingBySession[sessionId] ?? {};
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

			/** Arm the round clock on the first non-empty list for the session. */
			const startedAtBySession = { ...state.todoStartedAtBySession };
			if (items.length > 0 && !startedAtBySession[sessionId]) {
				startedAtBySession[sessionId] = now;
			}

			const allDone = items.length > 0 && !hasOpen;
			const completedAtBySession = { ...state.todoCompletedAtBySession };
			if (allDone && !completedAtBySession[sessionId]) {
				completedAtBySession[sessionId] = now;
			} else if (!allDone) {
				delete completedAtBySession[sessionId];
			}

			commit({
				todoStartedAtBySession: startedAtBySession,
				todoCompletedAtBySession: completedAtBySession,
				itemTimingBySession: {
					...state.itemTimingBySession,
					[sessionId]: nextTiming,
				},
				// Full replace — dismissed only persists while the list stays all-done.
				todosBySession: {
					...state.todosBySession,
					[sessionId]: {
						...list,
						items,
						dismissed: hasOpen
							? false
							: Boolean(state.todosBySession[sessionId]?.dismissed),
						// Fresh activity un-pauses a stopped round.
						paused: hasOpen ? false : state.todosBySession[sessionId]?.paused,
					},
				},
			});
			persistTodoSnapshot(sessionId);
		}

		/**
		 * User STOPPED the agent mid-run. Freeze the round as "paused" — items
		 * stay open, timers hold their value, and nothing is auto-completed.
		 * The user then chooses to continue or delete from the panel.
		 */
		function pauseTodosForSession(sessionId: string): void {
			const list = get().todosBySession[sessionId];
			if (!list || todoListAllDone(list)) return;
			commit({
				todosBySession: {
					...get().todosBySession,
					[sessionId]: { ...list, paused: true },
				},
			});
			persistTodoSnapshot(sessionId);
		}

		/**
		 * User chose CONTINUE on a paused list: un-pause and let the list
		 * survive the next prompt's new-task reset (consumed once).
		 */
		function resumeTodosForSession(sessionId: string): void {
			const list = get().todosBySession[sessionId];
			if (!list) return;
			const state = get();
			commit({
				skipNextResetBySession: {
					...state.skipNextResetBySession,
					[sessionId]: true,
				},
				todosBySession: {
					...state.todosBySession,
					[sessionId]: { ...list, paused: false },
				},
			});
		}

		function pruneStaleTodoSnapshots(knownSessionIds: Set<string>): void {
			let keys: string[] = [];
			try {
				keys = prefs.keys().filter((k) =>
					k.startsWith("pi-desktop:todo-snapshot:v1:"),
				);
			} catch {
				return;
			}
			for (const key of keys) {
				const id = key.slice("pi-desktop:todo-snapshot:v1:".length);
				if (!knownSessionIds.has(id)) {
					try {
						prefs.removeItem(key);
					} catch {
						// ignore
					}
				}
			}
		}

		/** User chose DELETE on a paused list: drop it entirely. */
		function deleteTodoList(sessionId: string): void {
			const state = get();
			const todosBySession = { ...state.todosBySession };
			delete todosBySession[sessionId];
			const clocks = { ...state.todoStartedAtBySession };
			delete clocks[sessionId];
			const ends = { ...state.todoCompletedAtBySession };
			delete ends[sessionId];
			const timings = { ...state.itemTimingBySession };
			delete timings[sessionId];
			const owned = { ...state.toolOwnedBySession };
			delete owned[sessionId];
			commit({
				todosBySession,
				todoStartedAtBySession: clocks,
				todoCompletedAtBySession: ends,
				itemTimingBySession: timings,
				toolOwnedBySession: owned,
			});
			dropTodoSnapshot(sessionId);
		}

		/**
		 * 回合结束：模型没回写的项保持未完成，只标记为「未回写」。
		 *
		 * 旧实现把它们一律改成 completed，把「模型漏报」伪装成「最后一次性全部完成」，
		 * 用户再也看不出哪一步没人确认。开始时钟保留在原 timing 里，
		 * 模型下一轮回写 completed 时仍然算得出真实耗时。
		 */
		function finalizeTodosForSession(sessionId: string): void {
			const list = get().todosBySession[sessionId];
			// Paused = user stopped this round on purpose — leave it alone.
			if (!list || list.paused) return;
			const now = Date.now();
			const timing = get().itemTimingBySession[sessionId] ?? {};
			let hasOpen = false;
			const items = list.items.map((item) => {
				if (item.done) return item;
				hasOpen = true;
				// 已标未回写的项上一轮就冻结过耗时 —— 恢复路径再跑一次时原样保留。
				if (item.unreported && item.durationMs != null) return item;
				const startedAt =
					item.startedAt ?? timing[item.text.trim()]?.startedAt ?? now;
				const { active: _active, startedAt: _startedAt, ...rest } = item;
				return {
					...rest,
					unreported: true,
					durationMs: Math.max(0, now - startedAt),
				};
			});
			if (!hasOpen) {
				// 模型已把清单收尾 —— 只补上回合完成时钟。
				if (!get().todoCompletedAtBySession[sessionId]) {
					commit({
						todoCompletedAtBySession: {
							...get().todoCompletedAtBySession,
							[sessionId]: now,
						},
					});
					persistTodoSnapshot(sessionId);
				}
				return;
			}
			// 还有未确认的项：本轮不算完成，清掉旧的结束时钟。
			const ends = { ...get().todoCompletedAtBySession };
			delete ends[sessionId];
			commit({
				todosBySession: {
					...get().todosBySession,
					[sessionId]: { ...list, items, dismissed: false },
				},
				todoCompletedAtBySession: ends,
			});
			persistTodoSnapshot(sessionId);
		}

		/**
		 * Reset the todo widget when a new task/turn starts. The UI list is
		 * dropped entirely and the builtin-tool ownership flag clears, so the
		 * next round's list (from any source) shows only that round's items.
		 */
		function resetTodosForSession(sessionId: string): void {
			const state = get();
			// "Continue task" armed by resumeTodosForSession — keep the list for
			// the follow-up prompt (the agent's next todo_write replaces it).
			if (state.skipNextResetBySession[sessionId]) {
				const skip = { ...state.skipNextResetBySession };
				delete skip[sessionId];
				commit({ skipNextResetBySession: skip });
				return;
			}
			const todosBySession = { ...state.todosBySession };
			delete todosBySession[sessionId];
			const clocks = { ...state.todoStartedAtBySession };
			delete clocks[sessionId];
			const ends = { ...state.todoCompletedAtBySession };
			delete ends[sessionId];
			const timings = { ...state.itemTimingBySession };
			delete timings[sessionId];
			const owned = { ...state.toolOwnedBySession };
			delete owned[sessionId];
			const skips = { ...state.skipNextResetBySession };
			delete skips[sessionId];
			commit({
				todosBySession,
				todoStartedAtBySession: clocks,
				todoCompletedAtBySession: ends,
				itemTimingBySession: timings,
				toolOwnedBySession: owned,
				skipNextResetBySession: skips,
			});
			dropTodoSnapshot(sessionId);
			const widgets = { ...state.widgetsBySession };
			const row = widgets[sessionId];
			if (row) {
				const cleaned: Record<string, string[]> = {};
				for (const [k, v] of Object.entries(row)) {
					if (!isTodoWidgetKey(k)) cleaned[k] = v;
				}
				widgets[sessionId] = cleaned;
				commit({ widgetsBySession: widgets });
			}
		}

		/** Hide the todo panel for this session (re-shows when new open items arrive). */
		function dismissTodoList(sessionId: string): void {
			const list = get().todosBySession[sessionId];
			if (!list) return;
			commit({
				todosBySession: {
					...get().todosBySession,
					[sessionId]: { ...list, dismissed: true },
				},
			});
		}

		function persistTodoSnapshot(sessionId: string): void {
			try {
				const state = get();
				const list = state.todosBySession[sessionId];
				if (!list || !list.items.length) {
					prefs.removeItem(todoSnapshotKey(sessionId));
					return;
				}
				const snapshot = serializeTodoSnapshot(
					sessionId,
					list,
					state.todoStartedAtBySession[sessionId] ?? 0,
					state.todoCompletedAtBySession[sessionId] ?? 0,
					Boolean(state.toolOwnedBySession[sessionId]),
					state.itemTimingBySession[sessionId] ?? {},
				);
				prefs.setItem(todoSnapshotKey(sessionId), JSON.stringify(snapshot));
			} catch {
				// ignore — best effort only
			}
		}

		function dropTodoSnapshot(sessionId: string): void {
			try {
				prefs.removeItem(todoSnapshotKey(sessionId));
			} catch {
				// ignore
			}
		}

		/**
		 * Reload / language-switch / app restart wipe renderer memory. Restore the
		 * last visible todo list per session from localStorage; live updates keep
		 * replacing it afterwards. Timers re-anchor to persisted start clocks.
		 */
		function restoreTodoSnapshots(): void {
			if (todoSnapshotRestored) return;
			todoSnapshotRestored = true;
			let keys: string[] = [];
			try {
				keys = prefs.keys().filter((k) =>
					k.startsWith("pi-desktop:todo-snapshot:v1:"),
				);
			} catch {
				return;
			}
			for (const key of keys) {
				let parsed: unknown = null;
				try {
					parsed = JSON.parse(prefs.getItem(key) ?? "null");
				} catch {
					continue;
				}
				const snapshot = parseTodoSnapshot(parsed);
				if (!snapshot) continue;
				const sessionId = snapshot.sessionId;
				const state = get();
				if (state.todosBySession[sessionId]) continue;
				const todosBySession = {
					...state.todosBySession,
					[sessionId]: snapshot.list,
				};
				const startedAtBySession = { ...state.todoStartedAtBySession };
				if (snapshot.startedAt) {
					startedAtBySession[sessionId] = snapshot.startedAt;
				}
				const completedAtBySession = { ...state.todoCompletedAtBySession };
				if (snapshot.completedAt) {
					completedAtBySession[sessionId] = snapshot.completedAt;
				}
				const owned = { ...state.toolOwnedBySession };
				if (snapshot.toolOwned) {
					owned[sessionId] = true;
				}
				const timings = { ...state.itemTimingBySession };
				if (snapshot.timings && Object.keys(snapshot.timings).length) {
					timings[sessionId] = snapshot.timings;
				}
				commit({
					todosBySession,
					todoStartedAtBySession: startedAtBySession,
					todoCompletedAtBySession: completedAtBySession,
					toolOwnedBySession: owned,
					itemTimingBySession: timings,
				});
			}
		}

		/** Hide completed list when the user starts the next task. */
		function dismissCompletedOnNewTask(sessionId: string): void {
			const list = get().todosBySession[sessionId];
			if (!list || !todoListAllDone(list)) return;
			commit({
				todosBySession: {
					...get().todosBySession,
					[sessionId]: { ...list, dismissed: true },
				},
			});
			persistTodoSnapshot(sessionId);
		}

		function clearSession(sessionId: string): void {
			const state = get();
			const { [sessionId]: _w, ...restW } = state.widgetsBySession;
			const { [sessionId]: _t, ...restT } = state.todosBySession;
			const { [sessionId]: _c, ...restC } = state.todoStartedAtBySession;
			const { [sessionId]: _e, ...restE } = state.todoCompletedAtBySession;
			const { [sessionId]: _o, ...restO } = state.toolOwnedBySession;
			const { [sessionId]: _m, ...restM } = state.itemTimingBySession;
			commit({
				widgetsBySession: restW,
				todosBySession: restT,
				todoStartedAtBySession: restC,
				todoCompletedAtBySession: restE,
				toolOwnedBySession: restO,
				itemTimingBySession: restM,
			});
			dropTodoSnapshot(sessionId);
		}

		return {
			...base,
			...derive(base),
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
			restoreTodoSnapshots,
			pruneStaleTodoSnapshots,
			clearSession,
		};
	},
);

useSessionsStore.subscribe((state, prev) => {
	if (state.activeId === prev.activeId) return;
	useSessionWidgetsStore.setState((s) => derive(s));
});

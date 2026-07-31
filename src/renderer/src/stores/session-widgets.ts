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
 */
export const useSessionWidgetsStore = defineStore("session-widgets", () => {
  /** sessionId → widgetKey → raw lines (null = cleared) */
  const widgetsBySession = ref<Record<string, Record<string, string[]>>>({});
  /** sessionId → structured todo list (primary UI) */
  const todosBySession = ref<Record<string, SessionTodoList | null>>({});

  const sessions = useSessionsStore();

  const activeTodoList = computed(() => {
    const id = sessions.activeId;
    if (!id) return null;
    const list = todosBySession.value[id];
    return todoListVisible(list) ? list : null;
  });

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
        const prev = todosBySession.value[sessionId];
        const hasOpen = parsed.items.some((i) => !i.done);
        todosBySession.value = {
          ...todosBySession.value,
          [sessionId]: {
            ...parsed,
            // Incomplete work always re-shows; keep dismiss only while still all-done.
            dismissed: hasOpen ? false : Boolean(prev?.dismissed),
          },
        };
      }
    }
  }

  function applyTodoToolResult(sessionId: string, details: unknown): void {
    applyTodoList(sessionId, todosFromToolDetails("pi-deck-todo", details), details);
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
    const prev = todosBySession.value[sessionId];
    const hasOpen = list.items.some((i) => !i.done);
    todosBySession.value = {
      ...todosBySession.value,
      [sessionId]: {
        ...list,
        dismissed: hasOpen ? false : Boolean(prev?.dismissed),
      },
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
    widgetsBySession.value = restW;
    todosBySession.value = restT;
  }

  return {
    widgetsBySession,
    todosBySession,
    activeTodoList,
    setWidget,
    applyTodoToolResult,
    applyTodoToolArgs,
    dismissCompletedOnNewTask,
    clearSession,
  };
});

/** Per-session extension widgets (todo / plan progress) for the chat chrome. */

export type SessionTodoItem = {
  id: string;
  text: string;
  done: boolean;
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

const TODO_WIDGET_KEYS = new Set(["pi-deck-todo", "pi-deck-plan-todos"]);

export function isTodoWidgetKey(key: string): boolean {
  return TODO_WIDGET_KEYS.has(key) || /todo/i.test(key);
}

/** Parse pi-deck-todo / plan-mode widget lines into a structured list. */
export function parseTodoWidgetLines(
  key: string,
  lines: string[],
): SessionTodoList | null {
  if (!lines.length) return null;
  const items: SessionTodoItem[] = [];
  let title = lines[0]?.trim() || "Todos";

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]?.trim() ?? "";
    if (!raw) continue;

    // Header: "待办事项 2/3" | "计划进度 1/4" | "Todos 2/3"
    if (i === 0 && !/^[☑☐✓○\[\]]/.test(raw)) {
      title = raw;
      continue;
    }

    const checkbox = raw.match(/^[☑☐✓○]\s+(?:#(\d+)\s+|(\d+)\.\s+)(.+)$/);
    if (checkbox) {
      const id = checkbox[1] || checkbox[2] || String(items.length + 1);
      const done = raw.startsWith("☑") || raw.startsWith("✓");
      items.push({ id, text: (checkbox[3] ?? "").trim(), done });
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

/** Build list from todo tool `details` payload. */
export function todosFromToolDetails(
  key: string,
  details: unknown,
): SessionTodoList | null {
  if (!details || typeof details !== "object") return null;
  const d = details as {
    todos?: unknown;
    action?: unknown;
  };
  if (!Array.isArray(d.todos)) return null;

  const items: SessionTodoItem[] = [];
  for (const row of d.todos) {
    if (!row || typeof row !== "object") continue;
    const t = row as {
      id?: unknown;
      text?: unknown;
      done?: unknown;
      step?: unknown;
      completed?: unknown;
    };
    const text = typeof t.text === "string" ? t.text.trim() : "";
    if (!text) continue;
    const id =
      typeof t.id === "number" || typeof t.id === "string"
        ? String(t.id)
        : typeof t.step === "number"
          ? String(t.step)
          : String(items.length + 1);
    const done = Boolean(t.done ?? t.completed);
    items.push({ id, text, done });
  }

  if (d.action === "clear" || items.length === 0) {
    return null;
  }

  const doneCount = items.filter((i) => i.done).length;
  return {
    key,
    title: `待办事项 ${doneCount}/${items.length}`,
    items,
    dismissed: false,
  };
}

export function todoListAllDone(list: SessionTodoList): boolean {
  return list.items.length > 0 && list.items.every((i) => i.done);
}

export function todoListVisible(list: SessionTodoList | null | undefined): boolean {
  if (!list || list.items.length === 0) return false;
  if (list.dismissed && todoListAllDone(list)) return false;
  return true;
}

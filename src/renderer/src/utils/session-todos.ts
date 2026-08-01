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

const TODO_WIDGET_KEYS = new Set(["pi-deck-todo", "pi-deck-plan-todos", "plan-todos"]);

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Tools that maintain a session todo list (pi-deck `todo`, Cursor-like `todo_write`, …). */
export function isTodoToolName(toolName: string): boolean {
  const n = toolName.trim().toLowerCase().replace(/[\s-]+/g, "_");
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
    items.push({ id, text, done });
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
  if (payload.action === "clear" || (Array.isArray(payload.rows) && items.length === 0)) {
    return null;
  }
  if (!items.length) return null;

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
export function todosFromToolArgs(key: string, args: unknown): SessionTodoList | null {
  if (!args || typeof args !== "object") return null;
  const a = args as { action?: unknown; todos?: unknown; tasks?: unknown; items?: unknown };
  if (a.action === "clear") return null;
  const rows = a.todos ?? a.tasks ?? a.items;
  if (!Array.isArray(rows)) return null;
  return todosFromToolDetails(key, { action: a.action, todos: rows });
}

export function todoListAllDone(list: SessionTodoList): boolean {
  return list.items.length > 0 && list.items.every((i) => i.done);
}

export function todoListVisible(list: SessionTodoList | null | undefined): boolean {
  if (!list || list.items.length === 0) return false;
  // Manually dismissed (or auto-dismissed after completion): hidden until the
  // next setWidget / tool update brings new open items (which resets dismissed).
  if (list.dismissed) return false;
  return true;
}

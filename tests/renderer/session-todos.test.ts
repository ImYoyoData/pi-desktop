import { describe, expect, it } from "vitest";
import {
  isTodoToolName,
  parseTodoWidgetLines,
  todoListAllDone,
  todoListVisible,
  todosFromToolArgs,
  todosFromToolDetails,
} from "../../src/renderer/src/utils/session-todos";
import { parseToolCard } from "../../src/renderer/src/utils/tool-diff";

describe("session-todos", () => {
  it("parses pi-deck-todo widget lines", () => {
    const list = parseTodoWidgetLines("pi-deck-todo", [
      "待办事项 1/2",
      "☑ #1 写测试",
      "☐ #2 修实现",
    ]);
    expect(list?.title).toBe("待办事项 1/2");
    expect(list?.items).toEqual([
      { id: "1", text: "写测试", done: true },
      { id: "2", text: "修实现", done: false },
    ]);
    expect(todoListAllDone(list!)).toBe(false);
    expect(todoListVisible(list!)).toBe(true);
  });

  it("parses plan-mode widget lines", () => {
    const list = parseTodoWidgetLines("pi-deck-plan-todos", [
      "计划进度 2/2",
      "☑ 1. 调研",
      "☑ 2. 实现",
    ]);
    expect(list?.items.every((i) => i.done)).toBe(true);
    expect(todoListVisible({ ...list!, dismissed: true })).toBe(false);
  });

  it("builds list from tool details and clears on clear action", () => {
    const list = todosFromToolDetails("pi-deck-todo", {
      action: "add",
      todos: [
        { id: 1, text: "a", done: false },
        { id: 2, text: "b", done: true },
      ],
      nextId: 3,
    });
    expect(list?.items).toHaveLength(2);
    expect(
      todosFromToolDetails("pi-deck-todo", { action: "clear", todos: [], nextId: 1 }),
    ).toBeNull();
  });

  it("accepts Cursor-like content/status todo_write payloads", () => {
    expect(isTodoToolName("todo_write")).toBe(true);
    const list = todosFromToolArgs("todo", {
      todos: [
        { id: "t1", content: "Wire overlay", status: "completed" },
        { id: "t2", content: "Add tests", status: "in_progress" },
        { id: "t3", content: "Write README", status: "pending" },
      ],
    });
    expect(list?.items).toEqual([
      { id: "t1", text: "Wire overlay", done: true },
      { id: "t2", text: "Add tests", done: false },
      { id: "t3", text: "Write README", done: false },
    ]);
  });

  it("ignores incremental pi-deck add args without a full list", () => {
    expect(todosFromToolArgs("todo", { action: "add", text: "only one" })).toBeNull();
  });

  it("parses a dedicated todo tool card", () => {
    const card = parseToolCard(
      "todo",
      { action: "add", text: "x" },
      {
        content: [{ type: "text", text: "Added todo #1: x" }],
        details: {
          action: "add",
          todos: [
            { id: 1, text: "x", done: false },
            { id: 2, text: "y", done: true },
          ],
          nextId: 3,
        },
      },
    );
    expect(card.kind).toBe("todo");
    if (card.kind !== "todo") return;
    expect(card.items).toHaveLength(2);
    expect(card.summary).toBe("1/2");
  });
});

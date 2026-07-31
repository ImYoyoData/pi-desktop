import { describe, expect, it } from "vitest";
import {
  parseTodoWidgetLines,
  todoListAllDone,
  todoListVisible,
  todosFromToolDetails,
} from "../../src/renderer/src/utils/session-todos";

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
});

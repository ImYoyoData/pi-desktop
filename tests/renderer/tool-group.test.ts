import { describe, expect, it } from "vitest";
import {
  buildWorkSectionSpans,
  categorizeToolCall,
  finalAnswerRowIds,
  summarizeWorkSection,
  workSectionCountSummary,
  workSectionLiveTitle,
  type WorkSectionRow,
  type WorkSectionSummaryStrings,
  type WorkSectionTool,
} from "../../src/renderer/src/utils/tool-group";

function row(partial: Partial<WorkSectionRow> & { id: string }): WorkSectionRow {
  return {
    role: "tool",
    toolName: "",
    hasText: false,
    hasThinking: false,
    ...partial,
  };
}

const askUser = (r: WorkSectionRow) => r.toolName === "ask_user";

describe("buildWorkSectionSpans", () => {
  it("groups consecutive tool calls into one work section", () => {
    const rows = [
      row({ id: "u", role: "user" }),
      row({ id: "t1", toolName: "read" }),
      row({ id: "t2", toolName: "bash" }),
      row({ id: "t3", toolName: "edit" }),
      row({ id: "a", role: "assistant", hasText: true }),
    ];
    expect(buildWorkSectionSpans(rows, askUser)).toEqual([
      { groupId: "ws:t1", start: 1, end: 4, ids: ["t1", "t2", "t3"] },
    ]);
  });

  it("pulls thinking-only assistant rows into the section", () => {
    const rows = [
      row({ id: "th", role: "assistant", hasThinking: true }),
      row({ id: "t1", toolName: "read" }),
      row({ id: "th2", role: "assistant", hasThinking: true }),
      row({ id: "t2", toolName: "read" }),
    ];
    expect(buildWorkSectionSpans(rows, askUser)).toEqual([
      { groupId: "ws:th", start: 0, end: 4, ids: ["th", "t1", "th2", "t2"] },
    ]);
  });

  it("breaks the section on answer text, user rows and interactive tools", () => {
    const rows = [
      row({ id: "t1", toolName: "read" }),
      row({ id: "a", role: "assistant", hasText: true, hasThinking: true }),
      row({ id: "ask", toolName: "ask_user" }),
      row({ id: "t2", toolName: "read" }),
      row({ id: "t3", toolName: "read" }),
    ];
    expect(buildWorkSectionSpans(rows, askUser)).toEqual([
      { groupId: "ws:t2", start: 3, end: 5, ids: ["t2", "t3"] },
    ]);
  });

  it("leaves a lone tool call standalone (single-item sections unwrap)", () => {
    const rows = [
      row({ id: "t1", toolName: "read" }),
      row({ id: "a", role: "assistant", hasText: true }),
      row({ id: "t2", toolName: "edit" }),
    ];
    expect(buildWorkSectionSpans(rows, askUser)).toEqual([]);
  });

  it("does not group thinking-only runs without any tool call", () => {
    const rows = [
      row({ id: "th1", role: "assistant", hasThinking: true }),
      row({ id: "th2", role: "assistant", hasThinking: true }),
    ];
    expect(buildWorkSectionSpans(rows, askUser)).toEqual([]);
  });
});

describe("finalAnswerRowIds", () => {
  it("marks only the last assistant text of a round", () => {
    const rows = [
      row({ id: "u", role: "user" }),
      row({ id: "mid", role: "assistant", hasText: true, hasThinking: true }),
      row({ id: "t1", toolName: "bash" }),
      row({ id: "final", role: "assistant", hasText: true }),
    ];
    expect(finalAnswerRowIds(rows)).toEqual(new Set(["final"]));
  });

  it("marks a final answer for every user round", () => {
    const rows = [
      row({ id: "u1", role: "user" }),
      row({ id: "a1", role: "assistant", hasText: true }),
      row({ id: "u2", role: "user" }),
      row({ id: "a2", role: "assistant", hasText: true }),
    ];
    expect(finalAnswerRowIds(rows)).toEqual(new Set(["a1", "a2"]));
  });

  it("ignores thinking-only and tool rows", () => {
    const rows = [
      row({ id: "u", role: "user" }),
      row({ id: "th", role: "assistant", hasThinking: true }),
      row({ id: "t1", toolName: "read" }),
      row({ id: "final", role: "assistant", hasText: true }),
    ];
    expect(finalAnswerRowIds(rows)).toEqual(new Set(["final"]));
  });

  it("returns an empty set when the round ends without a text answer", () => {
    const rows = [
      row({ id: "u", role: "user" }),
      row({ id: "t1", toolName: "bash" }),
      row({ id: "th", role: "assistant", hasThinking: true }),
    ];
    expect(finalAnswerRowIds(rows)).toEqual(new Set());
  });
});

describe("categorizeToolCall", () => {
  it("classifies edit/read/bash/todo/generic tools", () => {
    expect(categorizeToolCall("edit", { path: "src/App.vue" })).toEqual({
      kind: "edit",
      target: "App.vue",
    });
    expect(categorizeToolCall("read", { path: "docs/a.md" })).toEqual({
      kind: "read",
      target: "a.md",
    });
    expect(categorizeToolCall("bash", { command: "pnpm test" })).toEqual({
      kind: "bash",
      target: "pnpm test",
    });
    expect(categorizeToolCall("todo_write", {})).toEqual({
      kind: "todo",
      target: "",
    });
    expect(categorizeToolCall("mcp_fetch", {})).toEqual({
      kind: "tool",
      target: "mcp_fetch",
    });
  });

  it("truncates long commands for the live title", () => {
    const long = "x".repeat(80);
    const result = categorizeToolCall("bash", { command: long });
    expect(result.target.length).toBeLessThanOrEqual(48);
  });
});

const summaryStrings: WorkSectionSummaryStrings = {
  editOne: (f) => `Updated ${f}`,
  editMany: (n) => `Updated ${n} files`,
  readOne: (f) => `Reviewed ${f}`,
  readMany: (n) => `Reviewed ${n} files`,
  readAndEdited: (f) => `Reviewed and updated ${f}`,
  steps: (n) => `Finished with ${n} steps`,
  editCount: (n) => `Updated ${n} files`,
  readCount: (n) => `Reviewed ${n} files`,
  bashCount: (n) => `Ran ${n} commands`,
  todoCount: (n) => `Updated todos ${n} times`,
  toolCount: (n) => `Used ${n} tools`,
};

function tools(...list: WorkSectionTool[]): WorkSectionTool[] {
  return list;
}

describe("workSectionCountSummary", () => {
  it("joins one segment per category, each with its count", () => {
    expect(
      workSectionCountSummary(
        tools(
          { kind: "read", target: "a.ts" },
          { kind: "read", target: "b.ts" },
          { kind: "edit", target: "c.ts" },
          { kind: "bash", target: "ls" },
          { kind: "bash", target: "rg foo" },
          { kind: "todo", target: "" },
          { kind: "tool", target: "grep" },
        ),
        0,
        summaryStrings,
      ),
    ).toBe(
      "Updated 1 files · Reviewed 2 files · Ran 2 commands · Updated todos 1 times · Used 1 tools",
    );
  });

  it("drops categories with a count of zero", () => {
    expect(
      workSectionCountSummary(
        tools(
          { kind: "read", target: "a.ts" },
          { kind: "read", target: "b.ts" },
        ),
        0,
        summaryStrings,
      ),
    ).toBe("Reviewed 2 files");
  });

  it("falls back to a step count when the section has no tools", () => {
    expect(workSectionCountSummary([], 3, summaryStrings)).toBe("Finished with 3 steps");
    expect(workSectionCountSummary([], 0, summaryStrings)).toBe("Finished with 0 steps");
  });
});

describe("summarizeWorkSection", () => {
  it("combines read+edit of the same file", () => {
    expect(
      summarizeWorkSection(
        tools({ kind: "read", target: "App.vue" }, { kind: "edit", target: "App.vue" }),
        0,
        summaryStrings,
      ),
    ).toBe("Reviewed and updated App.vue");
  });

  it("uses real name for one file and counts for multiples", () => {
    expect(
      summarizeWorkSection(tools({ kind: "edit", target: "a.ts" }), 0, summaryStrings),
    ).toBe("Updated a.ts");
    expect(
      summarizeWorkSection(
        tools(
          { kind: "edit", target: "a.ts" },
          { kind: "edit", target: "b.ts" },
        ),
        0,
        summaryStrings,
      ),
    ).toBe("Updated 2 files");
    expect(
      summarizeWorkSection(
        tools(
          { kind: "read", target: "a.ts" },
          { kind: "read", target: "b.ts" },
          { kind: "read", target: "c.ts" },
        ),
        0,
        summaryStrings,
      ),
    ).toBe("Reviewed 3 files");
  });

  it("names a single file even when other step kinds are present", () => {
    expect(
      summarizeWorkSection(
        tools(
          { kind: "edit", target: "App.vue" },
          { kind: "bash", target: "pnpm test" },
          { kind: "todo", target: "" },
        ),
        0,
        summaryStrings,
      ),
    ).toBe("Updated App.vue");
  });

  it("falls back to a step count when there is no named file (Copilot style)", () => {
    expect(
      summarizeWorkSection(
        tools(
          { kind: "bash", target: "pnpm test" },
          { kind: "todo", target: "" },
          { kind: "tool", target: "mcp_fetch" },
        ),
        0,
        summaryStrings,
      ),
    ).toBe("Finished with 3 steps");
    expect(summarizeWorkSection(tools(), 3, summaryStrings)).toBe(
      "Finished with 3 steps",
    );
  });
});

describe("workSectionLiveTitle", () => {
  const live = {
    edit: (f: string) => `Editing ${f}`,
    read: (f: string) => `Reading ${f}`,
    bash: (c: string) => `Running ${c}`,
    todo: "Updating todos",
    tool: (name: string) => `Using ${name}`,
    thinking: "Thinking",
  };

  it("labels the latest step in present tense", () => {
    expect(workSectionLiveTitle(tools({ kind: "edit", target: "App.vue" }), live)).toBe(
      "Editing App.vue",
    );
    expect(
      workSectionLiveTitle(
        tools({ kind: "read", target: "a.ts" }, { kind: "bash", target: "pnpm test" }),
        live,
      ),
    ).toBe("Running pnpm test");
  });

  it("falls back to the thinking label without tool calls", () => {
    expect(workSectionLiveTitle(tools(), live)).toBe("Thinking");
  });
});


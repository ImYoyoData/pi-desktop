import { describe, expect, it } from "vitest";
import { parseToolCard, toolCardExpandable } from "../../src/renderer/src/utils/tool-diff";

function text(value: string) {
  return { content: [{ type: "text", text: value }] };
}

function detail(tool: string, args: unknown, result: unknown) {
  const card = parseToolCard(tool, args, result);
  expect(card.kind, tool).toBe("detail");
  if (card.kind !== "detail") throw new Error(tool);
  return card;
}

describe("detail tool cards", () => {
  it("parses every covered OMP tool", () => {
    detail("find", { path: "src" }, text("src/a.ts\nsrc/b.ts"));
    detail("glob", { pattern: "**/*.ts" }, text("src/a.ts"));
    detail(
      "ast_grep",
      { pat: "foo" },
      { content: [{ type: "text", text: "match" }], details: { matchCount: 1, fileCount: 1 } },
    );
    detail(
      "ast_edit",
      { paths: ["a.ts"] },
      { content: [{ type: "text", text: "done" }], details: { totalReplacements: 1 } },
    );
    detail(
      "eval",
      { language: "py", code: "print(1)" },
      { content: [{ type: "text", text: "1" }], details: { cells: [{ language: "py", code: "print(1)", output: "1" }] } },
    );
    detail(
      "task",
      { prompt: "inspect" },
      {
        content: [{ type: "text", text: "done" }],
        details: { results: [{ id: "a1", agent: "scout", task: "inspect", exitCode: 0, output: "done" }] },
      },
    );
    detail(
      "ask",
      { questions: [{ id: "1", question: "Q?", options: [{ label: "A" }] }] },
      { content: [{ type: "text", text: "A" }], details: { results: [{ question: "Q?", selectedOptions: ["A"] }] } },
    );
    detail("debug", { action: "continue" }, { content: [{ type: "text", text: "stopped" }], details: {} });
    detail("ida", { action: "exec", code: "print(1)" }, text("1"));
    detail("github", { op: "repo_view", repo: "o/r" }, text("repo"));
    detail("lsp", { action: "definition", file: "a.ts", line: 1 }, text("a.ts:1"));
    detail("checkpoint", { goal: "find bug" }, text("checkpoint"));
    detail("rewind", { report: "done" }, text("rewind"));
    detail("context_notes", { text: "note" }, { content: [{ type: "text", text: "note" }], details: { text: "note", bytes: 4 } });
    detail("new_context", {}, text("requested"));
    detail("security_scan", { action: "status" }, text("running"));
    detail("web_search", { query: "q" }, { content: [{ type: "text", text: "answer" }], details: { response: { sources: [] } } });
    detail("retain", { items: [{ content: "remember" }] }, text("stored"));
    detail("recall", { query: "q" }, text("Found 2 relevant memories"));
    detail("reflect", { query: "q" }, text("answer"));
    detail("memory_edit", { op: "update", id: "m1" }, text("updated"));
    detail("learn", { memory: "lesson" }, text("stored"));
    detail("manage_skill", { action: "create", name: "s" }, text("created"));
    detail("codemode", { code: "console.log(1)" }, text("Script completed\n===== a.js =====\nconsole.log(1)"));
    detail("tool_search", { query: "x" }, text("Loaded 2 tools: a, b"));
    detail("browser_snapshot", {}, { content: [{ type: "text", text: "snap" }], structuredContent: { url: "https://x", elements: [1] } });
    detail("mcp__fs__read", { path: "a" }, { content: [{ type: "text", text: "a" }], structuredContent: { ok: true } });
    detail("computer", { action: "screenshot" }, text("done"));
  });

  it("reconstructs nested directory paths for ast_grep", () => {
    const card = detail(
      "ast_grep",
      { pat: "foo" },
      {
        content: [{ type: "text", text: "match" }],
        details: {
          matchCount: 1,
          fileCount: 1,
          displayContent: "# src/\n## nested/\n### a.ts (1 match)\n*12│const x = 1",
        },
      },
    );
    const matches = card.sections.find((section) => section.kind === "matches");
    if (!matches || matches.kind !== "matches") throw new Error("missing matches");
    expect(matches.files[0]?.path).toBe("src/nested/a.ts");
  });

  it("reconstructs nested directory paths for ast_edit", () => {
    const card = detail(
      "ast_edit",
      { paths: ["src"] },
      {
        content: [{ type: "text", text: "done" }],
        details: {
          totalReplacements: 1,
          applied: true,
          displayContent: "# src/\n## nested/\n### a.ts (1 replacement)\n-12│old\n+12│new",
        },
      },
    );
    const diffs = card.sections.find((section) => section.kind === "diffs");
    if (!diffs || diffs.kind !== "diffs") throw new Error("missing diffs");
    expect(diffs.files[0]?.path).toBe("src/nested/a.ts");
    expect(diffs.files[0]?.diff).toContain("--- a/src/nested/a.ts");
  });

  it("keeps a flat ask answer and timeout state", () => {
    const card = detail(
      "ask",
      { questions: [{ id: "1", question: "Q?", options: [{ label: "A" }] }] },
      {
        content: [{ type: "text", text: "Answered" }],
        details: {
          question: "Q?",
          selectedOptions: ["A"],
          customInput: "custom",
          note: "note",
          timedOut: true,
        },
      },
    );
    const items = card.sections.find((section) => section.kind === "items");
    if (!items || items.kind !== "items") throw new Error("missing items");
    expect(items.items[0]?.subtitle).toBe("A");
    expect(items.items[0]?.body).toBe("note");
    expect(card.flags).toContain("timedOut");
  });

  it("reads form-based ask answers", () => {
    const card = detail(
      "ask",
      { html: "<form><input name=\"q1\" /></form>" },
      {
        content: [{ type: "text", text: "{\"q1\":\"A\"}" }],
        details: {
          answers: [{ name: "q1", question: "Pick one", answer: "A" }],
          timedOut: true,
        },
      },
    );
    const items = card.sections.find((section) => section.kind === "items");
    if (!items || items.kind !== "items") throw new Error("missing items");
    expect(items.items[0]?.title).toBe("Pick one");
    expect(items.items[0]?.subtitle).toBe("A");
    expect(card.sections.some((section) => section.kind === "text")).toBe(false);
    expect(card.flags).toContain("timedOut");
  });

  it("keeps historical task output next to task args", () => {
    const card = detail(
      "task",
      { tasks: [{ agent: "scout", prompt: "inspect" }] },
      "done",
    );
    expect(card.sections.some((section) => section.kind === "text" && section.text === "done")).toBe(true);
  });

  it("reads MCP structured content from details", () => {
    const card = detail("mcp__fs__read", { path: "a" }, {
      content: [{ type: "text", text: "a" }],
      details: { structuredContent: { ok: true } },
    });
    expect(card.sections.some((section) => section.kind === "json")).toBe(true);
  });

  it("keeps a scalar PR reference", () => {
    const card = detail("github", { op: "pr_checkout", pr: "123" }, text("checked out"));
    expect(card.chips.some((chip) => chip.kind === "text" && chip.text === "123")).toBe(true);
  });

  it("marks failed details centrally", () => {
    const card = parseToolCard(
      "checkpoint",
      { goal: "x" },
      { content: [{ type: "text", text: "denied" }] },
      { isError: true },
    );
    if (card.kind !== "detail") throw new Error("expected detail");
    expect(card.flags).toContain("failed");
  });

  it("is expandable when it has sections", () => {
    const card = detail("eval", { code: "print(1)" }, undefined);
    expect(toolCardExpandable(card)).toBe(true);
  });
});

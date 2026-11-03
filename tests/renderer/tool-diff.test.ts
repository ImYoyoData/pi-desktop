import { describe, expect, it } from "vitest";
import {
  countDiffStats,
  parseBashToolCard,
  parseFileToolCard,
  parseTodoToolCard,
  parseToolCard,
  toolCardExpandable,
  toolCardForNested,
} from "../../src/renderer/src/utils/tool-diff";

describe("countDiffStats", () => {
  it("counts unified diff additions and deletions", () => {
    const diff = [
      "--- a/x",
      "+++ b/x",
      "@@ -1,3 +1,3 @@",
      " context",
      "-old",
      "+new",
      "+extra",
    ].join("\n");
    expect(countDiffStats(diff)).toEqual({ additions: 2, deletions: 1 });
  });
});

describe("parseFileToolCard", () => {
  it("reads EditToolDetails from AgentToolResult", () => {
    const card = parseFileToolCard(
      "edit",
      { path: "src/a.ts", edits: [{ oldText: "a", newText: "b" }] },
      {
        content: [{ type: "text", text: "ok" }],
        details: {
          diff: "-1 a\n+1 b",
          patch: "--- a\n+++ b\n@@\n-a\n+b\n",
          firstChangedLine: 1,
        },
      },
    );
    expect(card.kind).toBe("edit");
    expect(card.path).toBe("src/a.ts");
    expect(card.stats).toEqual({ additions: 1, deletions: 1 });
    expect(card.diff).toContain("@@");
  });

  it("normalizes a numbered display diff to unified", () => {
    const card = parseFileToolCard("edit", { path: "a.ts" }, {
      content: [{ type: "text", text: "ok" }],
      details: { diff: " 1 const a = 1;\n+2 const b = 2;\n-3 const c = 3;" },
    });
    expect(card.kind).toBe("edit");
    expect(card.diff).toContain("@@");
    expect(card.diff).toContain(" const a = 1;");
    expect(card.diff).toContain("+const b = 2;");
    expect(card.diff).toContain("-const c = 3;");
    expect(card.stats).toEqual({ additions: 1, deletions: 1 });
  });

  it("summarizes write from args.content", () => {
    const card = parseFileToolCard("write", { path: "n.ts", content: "a\nb\nc" }, undefined);
    expect(card.kind).toBe("write");
    expect(card.stats).toEqual({ additions: 3, deletions: 0 });
    expect(card.diff).toContain("+a");
    expect(card.diff).toContain("+b");
    expect(card.diff).toContain("+c");
  });

  it("synthesizes edit preview from args while result is still streaming", () => {
    const card = parseFileToolCard(
      "edit",
      { path: "a.ts", oldText: "foo", newText: "bar" },
      undefined,
    );
    expect(card.kind).toBe("edit");
    expect(card.diff).toContain("-foo");
    expect(card.diff).toContain("+bar");
    expect(card.stats).toEqual({ additions: 1, deletions: 1 });
  });
});

describe("parseBashToolCard", () => {
  it("keeps command + output (not a file diff)", () => {
    const card = parseBashToolCard(
      { command: "npm test" },
      {
        content: [{ type: "text", text: "ok\npassed" }],
        details: {},
      },
    );
    expect(card.kind).toBe("bash");
    expect(card.command).toBe("npm test");
    expect(card.preview).toContain("passed");
  });
});

describe("generic tool summary", () => {
  it("prefers the path the tool operated on", () => {
    const card = parseToolCard("custom", { path: "src/a.ts", limit: 10 }, "ok");
    expect(card.kind).toBe("generic");
    if (card.kind !== "generic") return;
    expect(card.summary).toBe("src/a.ts");
  });

  it("falls back to the first line of a script", () => {
    const card = parseToolCard("codemode", { code: "\nconst a = 1;\n" }, "done");
    if (card.kind !== "generic") throw new Error("expected generic card");
    expect(card.summary).toBe("const a = 1;");
  });

  it("flags a preview that came from args instead of output", () => {
    const card = parseToolCard("custom", { path: "a.ts" }, undefined);
    if (card.kind !== "generic") throw new Error("expected generic card");
    expect(card.previewFromArgs).toBe(true);
  });
});

describe("parseTodoToolCard", () => {
  it("takes the action from the omp op", () => {
    const card = parseTodoToolCard({ op: "done", task: "写代码" }, undefined);
    expect(card.action).toBe("done");
  });

  it("keeps the task of an incremental op as the card body", () => {
    const card = parseTodoToolCard({ op: "done", task: "写代码" }, undefined);
    expect(card.items).toEqual([{ id: "1", text: "写代码", done: true }]);
    expect(card.total).toBeNull();
  });

  it("lists appended items without pretending to be the full list", () => {
    const card = parseTodoToolCard(
      { op: "append", phase: "P", items: ["补测试"] },
      undefined,
    );
    expect(card.action).toBe("append");
    expect(card.items.map((item) => item.text)).toEqual(["补测试"]);
    expect(card.total).toBeNull();
  });

  it("counts progress for a full list", () => {
    const card = parseTodoToolCard(
      { op: "init", list: [{ phase: "P", items: ["一", "二"] }] },
      undefined,
    );
    expect(card.action).toBe("init");
    expect(card.total).toBe(2);
    expect(card.summary).toBe("0/2");
  });

  it("reads the full list from omp details", () => {
    const card = parseTodoToolCard(
      { op: "done", task: "写代码" },
      {
        content: [{ type: "text", text: "ok" }],
        details: {
          op: "done",
          phases: [
            { name: "P", tasks: [{ content: "写代码", status: "completed" }] },
          ],
        },
      },
    );
    expect(card.action).toBe("done");
    expect(card.total).toBe(1);
    expect(card.summary).toBe("1/1");
  });

  it("keeps the cursor-style action", () => {
    const card = parseTodoToolCard(
      { action: "add", todos: [{ id: "1", content: "写代码" }] },
      undefined,
    );
    expect(card.action).toBe("add");
    expect(card.total).toBe(1);
  });

  it("gives an incremental op an expandable body", () => {
    const card = parseTodoToolCard({ op: "done", task: "写代码" }, undefined);
    expect(toolCardExpandable(card)).toBe(true);
  });
});

describe("parseWaitToolCard", () => {
  it("parses running jobs from a progress update without showing empty args", () => {
    const card = parseToolCard(
      "wait",
      {},
      {
        content: [{ type: "text", text: "" }],
        details: {
          op: "wait",
          jobs: [
            {
              id: "agent-1",
              type: "task",
              status: "running",
              label: "Implement login",
              intent: "add the login page",
              durationMs: 12_000,
              completionPercent: 40,
              stage: "writing tests",
              requests: 5,
              cost: 0.42,
              contextTokens: 45_000,
              contextWindow: 200_000,
              resolvedModel: "anthropic/claude",
            },
          ],
        },
      },
      { startedAt: 1_000 },
    );
    if (card.kind !== "wait") throw new Error("expected wait card");
    expect(card.jobs).toHaveLength(1);
    expect(card.jobs[0]).toMatchObject({
      id: "agent-1",
      agentId: "agent-1",
      status: "running",
      label: "Implement login",
      intent: "add the login page",
      durationMs: 12_000,
      completionPercent: 40,
      stage: "writing tests",
      requests: 5,
      cost: 0.42,
      contextTokens: 45_000,
      contextWindow: 200_000,
      model: "anthropic/claude",
    });
    expect(card.text).toBeNull();
    expect(card.startedAt).toBe(1_000);
    expect(toolCardExpandable(card)).toBe(true);
  });

  it("keeps the finished result text and ignores job entries without ids", () => {
    const card = parseToolCard(
      "wait",
      {},
      {
        content: [{ type: "text", text: "A service finished. Read proc:// for its status." }],
        details: { op: "wait", jobs: [{ status: "completed" }] },
      },
      { durationMs: 1_234 },
    );
    if (card.kind !== "wait") throw new Error("expected wait card");
    expect(card.jobs).toEqual([]);
    expect(card.text).toContain("A service finished");
    expect(card.durationMs).toBe(1_234);
    expect(toolCardExpandable(card)).toBe(true);
  });

  it("parses the live job widget: stage, headline and metric blocks", () => {
    const card = parseToolCard(
      "wait",
      {},
      {
        content: [{ type: "text", text: "" }],
        details: {
          op: "wait",
          jobs: [
            {
              id: "bench",
              type: "bash",
              status: "running",
              label: "cargo bench",
              durationMs: 9_000,
              widget: {
                title: "decode tok/s",
                headline: {
                  text: "186",
                  label: "tok/s",
                  trend: { text: "▲ 4%", tone: "success" },
                },
                stage: "warmup step 3",
                state: "live",
                blocks: [
                  { kind: "stat", items: [{ label: "lines", text: "1.2k" }] },
                  {
                    kind: "spark",
                    label: "tok/s",
                    values: [120, 140, 186],
                    min: 100,
                    max: 200,
                    last: "186",
                    tone: "accent",
                  },
                  { kind: "meter", label: "trials", value: 0.7, text: "7/9" },
                  { kind: "text", text: "running test 7" },
                  { kind: "unknown-block", text: "dropped" },
                ],
              },
            },
          ],
        },
      },
    );
    if (card.kind !== "wait") throw new Error("expected wait card");
    const widget = card.jobs[0]?.widget;
    if (!widget) throw new Error("expected a parsed widget");
    expect(widget.stage).toBe("warmup step 3");
    expect(widget.headline).toMatchObject({
      text: "186",
      label: "tok/s",
      trend: "▲ 4%",
      tone: "success",
    });
    expect(widget.blocks.map((block) => block.kind)).toEqual([
      "stat",
      "spark",
      "meter",
      "text",
    ]);
    expect(widget.blocks[1]).toMatchObject({ values: [120, 140, 186], last: "186" });
  });

  it("drops the body for an empty wait without output", () => {
    const card = parseToolCard("wait", {}, {
      content: [{ type: "text", text: "" }],
      details: { op: "wait", jobs: [] },
    });
    expect(card.kind).toBe("wait");
    expect(toolCardExpandable(card)).toBe(false);
  });
});

describe("toolCardForNested", () => {
  const call = {
    toolCallId: "nested-1",
    toolName: "read",
    args: { path: "a.ts" },
    result: "hello",
  };

  it("reuses the parsed card while the call content is unchanged", () => {
    const first = toolCardForNested(call);
    expect(toolCardForNested({ ...call })).toBe(first);
  });

  it("reparses when the result changes", () => {
    const first = toolCardForNested(call);
    const second = toolCardForNested({ ...call, result: "hello\nworld" });
    expect(second).not.toBe(first);
    expect(second.kind).toBe("read");
  });
});

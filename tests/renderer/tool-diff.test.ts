import { describe, expect, it } from "vitest";
import { countDiffStats, parseBashToolCard, parseFileToolCard } from "../../src/renderer/src/utils/tool-diff";

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
    expect(card.firstChangedLine).toBe(1);
    expect(card.diff).toContain("+1 b");
  });

  it("summarizes write from args.content", () => {
    const card = parseFileToolCard("write", { path: "n.ts", content: "a\nb\nc" }, undefined);
    expect(card.kind).toBe("write");
    expect(card.stats).toEqual({ additions: 3, deletions: 0 });
    expect(card.diff).toContain("+   1 a");
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

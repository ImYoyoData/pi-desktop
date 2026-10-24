import { describe, expect, it } from "vitest";
import { countDiffLines, parseUnifiedDiff } from "../../src/renderer/src/utils/diff-blocks";

const PATCH = [
  "--- a/src/x.ts",
  "+++ b/src/x.ts",
  "@@ -1,3 +1,4 @@",
  " keep",
  "-old",
  "+new",
  "+extra",
  " tail",
].join("\n");

describe("parseUnifiedDiff", () => {
  it("splits into one hunk and keeps the line order", () => {
    const parsed = parseUnifiedDiff(PATCH);
    expect(parsed.plain).toBe(false);
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0]!.lines.map((line) => line.kind)).toEqual([
      "ctx",
      "del",
      "add",
      "add",
      "ctx",
    ]);
  });

  it("pairs the deleted line with the first added line", () => {
    const parsed = parseUnifiedDiff(PATCH);
    const removed = parsed.hunks[0]!.lines.find((line) => line.kind === "del");
    const added = parsed.hunks[0]!.lines.find((line) => line.kind === "add");
    expect(removed?.oldParts?.some((part) => part.changed)).toBe(true);
    expect(added?.newParts?.some((part) => part.changed)).toBe(true);
  });

  it("leaves the unpaired added line without word marks", () => {
    const parsed = parseUnifiedDiff(PATCH);
    const added = parsed.hunks[0]!.lines.filter((line) => line.kind === "add");
    expect(added[1]?.newParts).toBeUndefined();
  });

  it("falls back to plain for text that is not a diff", () => {
    const parsed = parseUnifiedDiff("just some command output");
    expect(parsed.plain).toBe(true);
  });

  it("handles several hunks", () => {
    const parsed = parseUnifiedDiff(`${PATCH}\n@@ -20,2 +20,2 @@\n-a\n+b`);
    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.hunks[1]!.header).toBe("@@ -20,2 +20,2 @@");
  });
});

describe("countDiffLines", () => {
  it("counts additions and removals", () => {
    expect(countDiffLines(parseUnifiedDiff(PATCH).hunks)).toEqual({
      added: 2,
      removed: 1,
    });
  });
});

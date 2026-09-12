import { describe, expect, it } from "vitest";
import { buildSessionTree } from "../../src/renderer/src/utils/session-tree";
import type { SessionSummary } from "../../src/shared/protocol";

let seq = 0;
function s(id: string, parentSessionId?: string): SessionSummary {
  seq += 1;
  return {
    id,
    filePath: `/w/${id}.jsonl`,
    cwd: "/w",
    modified: new Date(2026, 0, 1, 0, 0, 0, seq).toISOString(),
    status: "idle",
    parentSessionId,
  };
}

const byModifiedDesc = (a: SessionSummary, b: SessionSummary) =>
  b.modified.localeCompare(a.modified);

describe("buildSessionTree", () => {
  it("nests forked sessions under their parent in preorder", () => {
    const parent = s("p");
    const c1 = s("c1", "p");
    const c2 = s("c2", "p");
    const items = buildSessionTree([c1, parent, c2], byModifiedDesc);
    expect(items.map((i) => [i.session.id, i.depth])).toEqual([
      ["p", 0],
      ["c2", 1],
      ["c1", 1],
    ]);
    expect(items[0]?.hasChildren).toBe(true);
    expect(items[1]?.parentId).toBe("p");
    expect(items[1]?.hasChildren).toBe(false);
    expect(items[0]?.parentId).toBeUndefined();
  });

  it("marks only the last displayed child's guide as half", () => {
    const parent = s("p");
    const c1 = s("c1", "p");
    const c2 = s("c2", "p");
    const items = buildSessionTree([parent, c1, c2], byModifiedDesc);
    // byModifiedDesc 下新会话在前，c1 排在最后（拐角收尾）。
    expect(items.find((i) => i.session.id === "c1")?.guides).toEqual(["half"]);
    expect(items.find((i) => i.session.id === "c2")?.guides).toEqual(["full"]);
  });

  it("draws full guides until the last leaf of a last-child subtree", () => {
    const p = s("p");
    const c = s("c", "p");
    const d1 = s("d1", "c");
    const d2 = s("d2", "c");
    const items = buildSessionTree([p, c, d1, d2], byModifiedDesc);
    const guidesOf = (id: string) =>
      items.find((i) => i.session.id === id)?.guides;
    expect(items.find((i) => i.session.id === "c")?.depth).toBe(1);
    expect(guidesOf("c")).toEqual(["full"]);
    expect(guidesOf("d2")).toEqual(["full", "full"]);
    expect(guidesOf("d1")).toEqual(["half", "half"]);
  });

  it("keeps orphans and cycles at the top level", () => {
    const orphan = s("o", "missing");
    const a = s("a", "b");
    const b = s("b", "a");
    const items = buildSessionTree([orphan, a, b], byModifiedDesc);
    expect(items.every((i) => i.depth === 0)).toBe(true);
  });
});

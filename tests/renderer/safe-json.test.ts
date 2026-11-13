import { describe, expect, it } from "vitest";
import { safeStringify } from "../../src/renderer/src/utils/safe-json";

describe("safeStringify", () => {
  it("serializes a shared reference twice instead of calling it circular", () => {
    const shared = { id: 1 };
    expect(JSON.parse(safeStringify({ a: shared, b: shared }))).toEqual({
      a: { id: 1 },
      b: { id: 1 },
    });
  });

  it("marks a real cycle as circular", () => {
    const node: Record<string, unknown> = { name: "n" };
    node.self = node;
    expect(JSON.parse(safeStringify(node))).toEqual({ name: "n", self: "[Circular]" });
  });

  it("keeps sibling references when a cycle exists elsewhere", () => {
    const shared = { id: 2 };
    const root: Record<string, unknown> = { first: shared, second: shared };
    root.loop = root;
    expect(JSON.parse(safeStringify(root))).toEqual({
      first: { id: 2 },
      second: { id: 2 },
      loop: "[Circular]",
    });
  });

  it("stringifies bigint values", () => {
    expect(JSON.parse(safeStringify({ n: 10n }))).toEqual({ n: "10" });
  });
});

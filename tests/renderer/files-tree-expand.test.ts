import { describe, expect, it } from "vitest";
import {
  ancestorChain,
  nextExpandedKeys,
} from "../../src/renderer/src/utils/files-tree-expand";

describe("ancestorChain", () => {
  it("builds path prefixes", () => {
    expect(ancestorChain("src/renderer/components")).toEqual([
      "src",
      "src/renderer",
      "src/renderer/components",
    ]);
  });
});

describe("nextExpandedKeys", () => {
  it("keeps collapse updates from the tree", () => {
    expect(nextExpandedKeys(["src", "src/a"], ["src"])).toEqual(["src"]);
    expect(nextExpandedKeys(["src"], [])).toEqual([]);
  });

  it("accordion-expands only the focused branch chain", () => {
    expect(nextExpandedKeys(["src", "src/a"], ["src", "src/a", "src/b"])).toEqual([
      "src",
      "src/b",
    ]);
    expect(nextExpandedKeys([], ["src"])).toEqual(["src"]);
    expect(nextExpandedKeys(["other"], ["other", "src/nested"])).toEqual([
      "src",
      "src/nested",
    ]);
  });
});

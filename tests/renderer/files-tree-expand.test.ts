import { describe, expect, it } from "vitest";
import { ancestorChain } from "../../src/renderer/src/utils/files-tree-expand";

describe("ancestorChain", () => {
  it("builds path prefixes", () => {
    expect(ancestorChain("src/renderer/components")).toEqual([
      "src",
      "src/renderer",
      "src/renderer/components",
    ]);
  });

  it("ignores empty segments", () => {
    expect(ancestorChain("src")).toEqual(["src"]);
    expect(ancestorChain("")).toEqual([]);
  });
});

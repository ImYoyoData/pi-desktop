import { describe, expect, it } from "vitest";
import { ellipsisMiddle, fileTagLabel, urlTagLabel } from "../../src/renderer/src/utils/path-label";

describe("ellipsisMiddle", () => {
  it("returns short strings unchanged", () => {
    expect(ellipsisMiddle("abc", 10)).toBe("abc");
  });

  it("hides the middle when over max", () => {
    expect(ellipsisMiddle("abcdefghij", 7)).toBe("abc…hij");
  });
});

describe("fileTagLabel", () => {
  it("keeps short paths", () => {
    expect(fileTagLabel("src/a.ts")).toBe("src/a.ts");
  });

  it("ellipsizes the middle of long paths", () => {
    const path = "src/very/long/nested/directory/structure/component.ts";
    const label = fileTagLabel(path, 28);
    expect(label.length).toBeLessThanOrEqual(28);
    expect(label).toContain("…");
    expect(label.startsWith("src")).toBe(true);
    expect(label.endsWith("component.ts") || label.endsWith(".ts")).toBe(true);
  });
});

describe("urlTagLabel", () => {
  it("ellipsizes the middle of long URLs", () => {
    const url = "https://example.com/very/long/path/to/resource?query=1";
    const label = urlTagLabel(url, 24);
    expect(label.length).toBeLessThanOrEqual(24);
    expect(label).toContain("…");
  });
});

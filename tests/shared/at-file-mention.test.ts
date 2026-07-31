import { describe, expect, it } from "vitest";
import {
  atFileDirLabel,
  filterAtFileItems,
  parseAtFileContext,
  replaceAtFileMention,
  type AtFileItem,
} from "../../src/shared/at-file-mention";

describe("parseAtFileContext", () => {
  it("detects bare @ at end", () => {
    expect(parseAtFileContext("@")).toEqual({ query: "", atIndex: 0 });
    expect(parseAtFileContext("see @")).toEqual({ query: "", atIndex: 4 });
  });

  it("captures path query after @", () => {
    expect(parseAtFileContext("look @src/comp")).toEqual({
      query: "src/comp",
      atIndex: 5,
    });
    expect(parseAtFileContext("a\n@foo")).toEqual({ query: "foo", atIndex: 2 });
  });

  it("allows multi-token fuzzy queries with spaces", () => {
    expect(parseAtFileContext("@comp vue")).toEqual({
      query: "comp vue",
      atIndex: 0,
    });
  });

  it("ignores email-like and non-terminal tokens", () => {
    expect(parseAtFileContext("plain")).toBeNull();
    expect(parseAtFileContext("user@host.com")).toBeNull();
    expect(parseAtFileContext("@foo\nmore")).toBeNull();
  });
});

describe("replaceAtFileMention", () => {
  it("strips the @ token", () => {
    const draft = "see @src/a";
    const ctx = parseAtFileContext(draft)!;
    expect(replaceAtFileMention(draft, ctx)).toBe("see");
  });
});

describe("filterAtFileItems", () => {
  const items: AtFileItem[] = [
    { name: "Composer.vue", path: "src/components/Composer.vue", kind: "file" },
    { name: "ComposerAtFileMenu.vue", path: "src/components/ComposerAtFileMenu.vue", kind: "file" },
    { name: "src", path: "src", kind: "dir" },
  ];

  it("returns all when query empty", () => {
    expect(filterAtFileItems(items, "")).toHaveLength(3);
  });

  it("fuzzy-matches name, path, and camelCase acronyms", () => {
    expect(filterAtFileItems(items, "composer").map((i) => i.path)).toEqual([
      "src/components/Composer.vue",
      "src/components/ComposerAtFileMenu.vue",
    ]);
    expect(filterAtFileItems(items, "cafm").map((i) => i.name)).toEqual([
      "ComposerAtFileMenu.vue",
    ]);
    expect(filterAtFileItems(items, "comp vue").some((i) => i.name === "Composer.vue")).toBe(
      true,
    );
  });
});

describe("atFileDirLabel", () => {
  it("returns parent directory", () => {
    expect(atFileDirLabel("src/components/Composer.vue")).toBe("src/components");
    expect(atFileDirLabel("README.md")).toBe("");
  });
});

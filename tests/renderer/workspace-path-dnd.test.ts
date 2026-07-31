import { describe, expect, it } from "vitest";
import {
  decodeWorkspacePaths,
  encodeWorkspacePaths,
  looksLikeWorkspaceRelPath,
  PI_WORKSPACE_PATHS_MIME,
} from "../../src/renderer/src/utils/workspace-path-dnd";

describe("workspace-path-dnd", () => {
  it("exports a stable custom MIME", () => {
    expect(PI_WORKSPACE_PATHS_MIME).toBe("application/x-pi-workspace-paths");
  });

  it("round-trips relative paths as JSON", () => {
    const encoded = encodeWorkspacePaths(["src/a.ts", ".\\docs\\b.md", ""]);
    expect(encoded).toBe(JSON.stringify(["src/a.ts", "docs/b.md"]));
    expect(decodeWorkspacePaths(encoded)).toEqual(["src/a.ts", "docs/b.md"]);
  });

  it("decodes newline fallback payloads", () => {
    expect(decodeWorkspacePaths("foo/bar.ts\n./baz.ts\n")).toEqual(["foo/bar.ts", "baz.ts"]);
  });

  it("detects workspace-relative path tokens", () => {
    expect(looksLikeWorkspaceRelPath("src/Composer.vue")).toBe(true);
    expect(looksLikeWorkspaceRelPath("docs/superpowers/plans/x.md")).toBe(true);
    expect(looksLikeWorkspaceRelPath("C:\\Users\\x\\file.ts")).toBe(false);
    expect(looksLikeWorkspaceRelPath("/tmp/a.ts")).toBe(false);
    expect(looksLikeWorkspaceRelPath("https://example.com")).toBe(false);
    expect(looksLikeWorkspaceRelPath("file:///C:/a.ts")).toBe(false);
  });

  it("rejects prose so pasting plain text never becomes a file tag", () => {
    expect(looksLikeWorkspaceRelPath("帮我写一个函数")).toBe(false);
    expect(looksLikeWorkspaceRelPath("hello world")).toBe(false);
    expect(looksLikeWorkspaceRelPath("please review my code")).toBe(false);
    expect(looksLikeWorkspaceRelPath("12345")).toBe(false);
    expect(looksLikeWorkspaceRelPath("const a = 1")).toBe(false);
  });

  it("still accepts single filenames and quoted paths with spaces", () => {
    expect(looksLikeWorkspaceRelPath("README.md")).toBe(true);
    expect(looksLikeWorkspaceRelPath("vite.config.ts")).toBe(true);
    expect(looksLikeWorkspaceRelPath("./main.ts")).toBe(true);
    expect(looksLikeWorkspaceRelPath("../src/App.vue")).toBe(true);
    expect(looksLikeWorkspaceRelPath('"my folder/file.txt"')).toBe(true);
    expect(looksLikeWorkspaceRelPath("my folder/file.txt")).toBe(false);
  });
});

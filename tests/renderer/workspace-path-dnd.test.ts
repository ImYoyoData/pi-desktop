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
});

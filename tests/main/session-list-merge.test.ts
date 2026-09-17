import { describe, expect, it } from "vitest";
import { normalizeWorkspacePath } from "../../src/main/session-list";
import { normalizeStoredWorkspacePath } from "../../src/main/workspace-store";

/**
 * Guards for the "extra blank workspace in the sidebar" report.
 *
 * A blank path is not inert: `path.resolve("")` is the process cwd, so a stored
 * `""` turns into the app's own directory as a workspace, and the sidebar renders
 * `basename(root)` — i.e. an extra, nameless row.
 */
describe("blank workspace paths are rejected", () => {
  it("rejects blanks, whitespace and non-strings", () => {
    expect(normalizeStoredWorkspacePath("")).toBeNull();
    expect(normalizeStoredWorkspacePath("   ")).toBeNull();
    expect(normalizeStoredWorkspacePath("\t\n ")).toBeNull();
    expect(normalizeStoredWorkspacePath(null)).toBeNull();
    expect(normalizeStoredWorkspacePath(undefined)).toBeNull();
    expect(normalizeStoredWorkspacePath(42)).toBeNull();
  });

  it("keeps a real path, trimmed and verbatim", () => {
    expect(normalizeStoredWorkspacePath("  /proj/app  ")).toBe("/proj/app");
    expect(normalizeStoredWorkspacePath("D:\\Work\\App")).toBe("D:\\Work\\App");
  });

  it("documents why blank is dangerous: it resolves to the cwd", () => {
    // Not a behaviour to rely on — this is the trap being guarded against.
    expect(normalizeWorkspacePath("")).toBe(normalizeWorkspacePath("   "));
  });
});

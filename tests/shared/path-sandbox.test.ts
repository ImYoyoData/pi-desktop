import { describe, expect, it } from "vitest";
import { isPathInsideRoot, resolveWorkspacePath } from "../../src/shared/path-sandbox";
import path from "node:path";

describe("path-sandbox", () => {
  const root = path.resolve("/tmp/workspace-demo");

  it("allows files inside root", () => {
    const p = resolveWorkspacePath(root, "src/a.ts");
    expect(isPathInsideRoot(root, p)).toBe(true);
  });

  it("denies .. escape", () => {
    expect(() => resolveWorkspacePath(root, "../outside.txt")).toThrow(/escape|outside/i);
  });
});

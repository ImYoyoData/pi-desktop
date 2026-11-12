import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolvePreviewReadPath,
  resolvePreviewWritePath,
} from "../../src/main/preview-paths";

describe("preview path resolution", () => {
  const root = path.resolve("/tmp/pi-ws");
  const agentRoot = path.resolve("/tmp/pi-agent");

  it("resolves relative write paths against the workspace root", () => {
    expect(resolvePreviewWritePath(root, "docs/readme.md", agentRoot)).toBe(
      path.resolve(root, "docs/readme.md"),
    );
  });

  it("allows relative escapes that land inside the agent directory", () => {
    const escaped = "../pi-agent/settings.json";
    expect(resolvePreviewWritePath(root, escaped, agentRoot)).toBe(
      path.resolve(root, escaped),
    );
  });

  it("rejects relative escapes outside both roots", () => {
    expect(() => resolvePreviewWritePath(root, "../elsewhere/x.md", agentRoot)).toThrow();
  });

  it("keeps absolute read paths as-is and resolves relative ones against the root", () => {
    const absolute = path.resolve("/tmp/other/file.txt");
    expect(resolvePreviewReadPath(root, absolute)).toBe(absolute);
    expect(resolvePreviewReadPath(root, "notes/a.txt")).toBe(path.resolve(root, "notes/a.txt"));
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addGitIgnored,
  isGitIgnoredPath,
  listGitIgnored,
  removeGitIgnored,
} from "../../src/main/git-ignore-store";

describe("git-ignore-store (.gitignore-backed)", () => {
  let ws: string;

  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-ignore-"));
  });

  afterEach(() => {
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("appends managed rules to .gitignore and lists them", () => {
    addGitIgnored(ws, ["dist", "tmp.log"]);
    // Folder paths passed as objects get the gitignore trailing slash.
    addGitIgnored(ws, [{ relativePath: "build", isDir: true }]);
    const raw = fs.readFileSync(path.join(ws, ".gitignore"), "utf8");
    expect(raw).toContain("dist");
    expect(raw).toContain("build/");
    expect(raw).toContain("tmp.log");
    expect(listGitIgnored(ws)).toEqual(["build/", "dist", "tmp.log"]);
  });

  it("keeps user rules untouched and removes only managed ones", () => {
    fs.writeFileSync(path.join(ws, ".gitignore"), "node_modules/\n", "utf8");
    addGitIgnored(ws, ["out/"]);
    removeGitIgnored(ws, "out");
    const raw = fs.readFileSync(path.join(ws, ".gitignore"), "utf8");
    expect(raw).toContain("node_modules/");
    expect(raw).not.toContain("pi-desktop filter");
  });

  it("matches exact files and folder prefixes", () => {
    addGitIgnored(ws, ["dist", "tmp.log"]);
    expect(isGitIgnoredPath(ws, "dist/child/x.js")).toBe(true);
    expect(isGitIgnoredPath(ws, "dist")).toBe(true);
    expect(isGitIgnoredPath(ws, "tmp.log")).toBe(true);
    expect(isGitIgnoredPath(ws, "src/a.ts")).toBe(false);
  });
});

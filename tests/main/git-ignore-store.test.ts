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

describe("git-ignore-store", () => {
  let tmp: string;
  let prev: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-ignore-"));
    prev = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = tmp;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("adds / lists / removes ignored paths per workspace", () => {
    addGitIgnored("C:/ws", ["dist", "out/app.js"]);
    expect(listGitIgnored("c:/ws")).toEqual(["dist", "out/app.js"]);
    removeGitIgnored("C:/ws", "dist");
    expect(listGitIgnored("C:/ws")).toEqual(["out/app.js"]);
  });

  it("matches exact files and folder prefixes", () => {
    addGitIgnored("C:/ws", ["dist", "tmp.log"]);
    expect(isGitIgnoredPath("C:/ws", "dist")).toBe(true);
    expect(isGitIgnoredPath("C:/ws", "dist/child/x.js")).toBe(true);
    expect(isGitIgnoredPath("C:/ws", "tmp.log")).toBe(true);
    expect(isGitIgnoredPath("C:/ws", "src/a.ts")).toBe(false);
  });
});

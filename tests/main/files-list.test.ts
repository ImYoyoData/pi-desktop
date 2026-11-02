import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listWorkspaceDir } from "../../src/main/files-host";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-files-list-"));
  temps.push(root);
  return root;
}

describe("listWorkspaceDir", () => {
  it("lists directories first, then files, each sorted by name", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "Beta"));
    fs.mkdirSync(path.join(root, "alpha"));
    fs.writeFileSync(path.join(root, "zeta.txt"), "");
    fs.writeFileSync(path.join(root, "Gamma.txt"), "");

    expect(listWorkspaceDir(root).map((entry) => entry.name)).toEqual([
      "alpha",
      "Beta",
      "Gamma.txt",
      "zeta.txt",
    ]);
  });

  it("tags entries with their kind and relative path", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "main.ts"), "");

    const rootEntries = listWorkspaceDir(root);
    expect(rootEntries).toEqual([{ name: "src", path: "src", kind: "dir" }]);

    expect(listWorkspaceDir(root, "src")).toEqual([
      { name: "main.ts", path: "src/main.ts", kind: "file" },
    ]);
  });

  it("skips heavy build and dependency directories", () => {
    const root = makeRoot();
    for (const name of [
      "node_modules",
      "dist",
      "out",
      "release",
      "coverage",
      "__pycache__",
    ]) {
      fs.mkdirSync(path.join(root, name));
    }
    fs.mkdirSync(path.join(root, "src"));

    expect(listWorkspaceDir(root).map((entry) => entry.name)).toEqual(["src"]);
  });

  it("returns nothing for a missing folder or a plain file", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "README.md"), "");

    expect(listWorkspaceDir(root, "missing")).toEqual([]);
    expect(listWorkspaceDir(root, "README.md")).toEqual([]);
  });

  it("resolves symlinked folders as directories", () => {
    const root = makeRoot();
    const target = path.join(root, "real-target");
    fs.mkdirSync(target);
    try {
      fs.symlinkSync(target, path.join(root, "linked"), "junction");
    } catch {
      return;
    }

    const linked = listWorkspaceDir(root).find((entry) => entry.name === "linked");
    expect(linked?.kind).toBe("dir");
  });
});

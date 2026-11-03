import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renameWorkspaceEntry } from "../../src/main/files-host";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-files-rename-"));
  temps.push(root);
  return root;
}

describe("renameWorkspaceEntry", () => {
  it("treats an unchanged name as a no-op", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "a.txt"), "x");
    expect(renameWorkspaceEntry(root, "a.txt", "a.txt")).toBe("a.txt");
    expect(fs.readdirSync(root)).toEqual(["a.txt"]);
  });

  it("renames inside a subdirectory", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "a.txt"), "x");
    expect(renameWorkspaceEntry(root, "src/a.txt", "b.txt")).toBe("src/b.txt");
    expect(fs.readdirSync(path.join(root, "src"))).toEqual(["b.txt"]);
  });

  it("rejects a name that already exists", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "a.txt"), "x");
    fs.writeFileSync(path.join(root, "b.txt"), "y");
    expect(() => renameWorkspaceEntry(root, "a.txt", "b.txt")).toThrow(
      "That name already exists",
    );
  });

  it("allows case-only renames", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "a.txt"), "x");
    expect(renameWorkspaceEntry(root, "a.txt", "A.txt")).toBe("A.txt");
    expect(fs.readdirSync(root)).toEqual(["A.txt"]);
  });
});

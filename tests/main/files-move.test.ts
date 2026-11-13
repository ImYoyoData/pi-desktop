import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { moveWorkspaceEntry, renameWorkspaceEntry } from "../../src/main/files-host";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-files-move-"));
  temps.push(root);
  return root;
}

describe("moveWorkspaceEntry", () => {
  it("moves a file into a subdirectory", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "dest"));
    fs.writeFileSync(path.join(root, "a.txt"), "x");
    expect(moveWorkspaceEntry(root, "a.txt", "dest")).toBe("dest/a.txt");
    expect(fs.readdirSync(path.join(root, "dest"))).toEqual(["a.txt"]);
    expect(fs.existsSync(path.join(root, "a.txt"))).toBe(false);
  });

  it("rejects moving the workspace root", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "dest"));
    expect(() => moveWorkspaceEntry(root, "", "dest")).toThrow(
      "Cannot move the workspace root",
    );
    expect(fs.readdirSync(root).sort()).toEqual(["dest"]);
  });

  it("rejects moving a folder into its own subdirectory", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "dir", "nested"), { recursive: true });
    // "./dir" must be recognized as the same entry as "dir" (path comparison,
    // not string prefix comparison).
    expect(() => moveWorkspaceEntry(root, "./dir", "dir/nested")).toThrow(
      "Cannot move into itself or a subdirectory",
    );
  });

  it("rejects a missing destination folder", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "a.txt"), "x");
    expect(() => moveWorkspaceEntry(root, "a.txt", "nope")).toThrow(
      "Destination folder does not exist",
    );
  });

  it("rejects a name collision in the destination", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "dest"));
    fs.writeFileSync(path.join(root, "a.txt"), "x");
    fs.writeFileSync(path.join(root, "dest", "a.txt"), "y");
    expect(() => moveWorkspaceEntry(root, "a.txt", "dest")).toThrow(
      "An item with that name already exists there",
    );
  });
});

describe("renameWorkspaceEntry", () => {
  it("rejects renaming the workspace root", () => {
    const root = makeRoot();
    expect(() => renameWorkspaceEntry(root, "", "renamed")).toThrow(
      "Cannot rename the workspace root",
    );
  });
});

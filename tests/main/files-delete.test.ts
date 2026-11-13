import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deleteWorkspaceEntry } from "../../src/main/files-host";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-files-delete-"));
  temps.push(root);
  return root;
}

describe("deleteWorkspaceEntry", () => {
  it("deletes a file inside the workspace", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "a.txt"), "x");
    deleteWorkspaceEntry(root, "a.txt");
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("rejects the workspace root", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "a.txt"), "x");
    expect(() => deleteWorkspaceEntry(root, "")).toThrow("workspace root");
    expect(() => deleteWorkspaceEntry(root, ".")).toThrow("workspace root");
    expect(() => deleteWorkspaceEntry(root, root)).toThrow("workspace root");
    expect(fs.existsSync(path.join(root, "a.txt"))).toBe(true);
  });
});

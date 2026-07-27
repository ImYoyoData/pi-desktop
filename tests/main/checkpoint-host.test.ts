import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  _resetCheckpointsForTests,
  beginCheckpoint,
  finishCheckpoint,
  noteCheckpointFsChange,
  revertCheckpoint,
  snapshotWorkspaceBaseline,
} from "../../src/main/checkpoint-host";

describe("checkpoint-host", () => {
  let root: string;

  beforeEach(() => {
    _resetCheckpointsForTests();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ckpt-"));
  });

  afterEach(() => {
    _resetCheckpointsForTests();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("snapshots text files and skips ignored dirs", () => {
    fs.writeFileSync(path.join(root, "a.txt"), "hello", "utf8");
    fs.mkdirSync(path.join(root, "node_modules"));
    fs.writeFileSync(path.join(root, "node_modules", "x.js"), "skip", "utf8");
    const { baseline, skipped } = snapshotWorkspaceBaseline(root);
    expect(baseline.get("a.txt")).toBe("hello");
    expect(baseline.has("node_modules/x.js")).toBe(false);
    expect(skipped).toBe(0);
  });

  it("reverts modified, created, and deleted files", () => {
    fs.writeFileSync(path.join(root, "keep.txt"), "v1", "utf8");
    fs.writeFileSync(path.join(root, "gone.txt"), "bye", "utf8");

    beginCheckpoint("s1", "u1", root);
    noteCheckpointFsChange(root, "keep.txt", "change");
    noteCheckpointFsChange(root, "new.txt", "add");
    noteCheckpointFsChange(root, "gone.txt", "unlink");

    fs.writeFileSync(path.join(root, "keep.txt"), "v2", "utf8");
    fs.writeFileSync(path.join(root, "new.txt"), "created", "utf8");
    fs.unlinkSync(path.join(root, "gone.txt"));

    const finished = finishCheckpoint("s1", "u1");
    expect(finished.status).toBe("ready");
    expect(finished.fileCount).toBe(3);

    const result = revertCheckpoint("s1", "u1", root);
    expect(result.ok).toBe(true);
    expect(result.restored).toBe(2);
    expect(result.deleted).toBe(1);
    expect(fs.readFileSync(path.join(root, "keep.txt"), "utf8")).toBe("v1");
    expect(fs.readFileSync(path.join(root, "gone.txt"), "utf8")).toBe("bye");
    expect(fs.existsSync(path.join(root, "new.txt"))).toBe(false);
  });

  it("marks empty when nothing touched", () => {
    fs.writeFileSync(path.join(root, "a.txt"), "x", "utf8");
    beginCheckpoint("s1", "u1", root);
    const finished = finishCheckpoint("s1", "u1");
    expect(finished.status).toBe("empty");
    expect(finished.fileCount).toBe(0);
  });

  it("finishes previous capturing when begin is called again", () => {
    fs.writeFileSync(path.join(root, "a.txt"), "x", "utf8");
    beginCheckpoint("s1", "u1", root);
    noteCheckpointFsChange(root, "a.txt", "change");
    beginCheckpoint("s1", "u2", root);
    const first = finishCheckpoint("s1", "u1");
    // already finished by second begin
    expect(first.status).toBe("ready");
  });
});

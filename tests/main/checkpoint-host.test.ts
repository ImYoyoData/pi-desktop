import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	_resetCheckpointsForTests,
	beginCheckpoint,
	finishCheckpoint,
	initCheckpointPersistence,
	listSessionCheckpointSummaries,
	noteCheckpointFsChange,
	revertCheckpoint,
	sessionNetFileChanges,
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

	it("computes net session changes against the session-start baseline", () => {
		fs.writeFileSync(path.join(root, "keep.txt"), "a\nb\nc", "utf8");
		fs.writeFileSync(path.join(root, "gone.txt"), "x\ny", "utf8");
		beginCheckpoint("s1", "u1", root);

		// Agent-style mutations after the baseline snapshot.
		fs.writeFileSync(path.join(root, "keep.txt"), "a\nb2\nc\nd", "utf8");
		fs.writeFileSync(path.join(root, "new.txt"), "n1\nn2\nn3", "utf8");
		fs.unlinkSync(path.join(root, "gone.txt"));

		const result = sessionNetFileChanges("s1", [
			"keep.txt",
			"new.txt",
			"gone.txt",
		]);
		expect(result["keep.txt"]).toEqual({
			additions: 2,
			deletions: 1,
			available: true,
		});
		expect(result["new.txt"]).toEqual({
			additions: 3,
			deletions: 0,
			available: true,
		});
		expect(result["gone.txt"]).toEqual({
			additions: 0,
			deletions: 2,
			available: true,
		});
	});

	it("uses the FIRST checkpoint as session start even across turns", () => {
		fs.writeFileSync(path.join(root, "f.txt"), "v1", "utf8");
		beginCheckpoint("s1", "u1", root);

		// Turn 1 edits land, then a second prompt snapshots the new state.
		fs.writeFileSync(path.join(root, "f.txt"), "v2", "utf8");
		beginCheckpoint("s1", "u2", root);
		fs.writeFileSync(path.join(root, "f.txt"), "v2\nmore", "utf8");

		const result = sessionNetFileChanges("s1", ["f.txt"]);
		// Net is still v1 → current, not v2 → current.
		expect(result["f.txt"]).toEqual({
			additions: 2,
			deletions: 1,
			available: true,
		});
	});

	it("marks unavailable without a session-start baseline", () => {
		fs.writeFileSync(path.join(root, "f.txt"), "v1", "utf8");
		const result = sessionNetFileChanges("s-missing", ["f.txt"]);
		expect(result["f.txt"]).toEqual({
			additions: 0,
			deletions: 0,
			available: false,
		});
	});

	it("rejects paths that escape the workspace", () => {
		beginCheckpoint("s1", "u1", root);
		const result = sessionNetFileChanges("s1", ["../outside.txt", "a\\..\\b"]);
		expect(result["../outside.txt"].available).toBe(false);
		expect(result["a\\..\\b"].available).toBe(false);
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

	it("persists finished summaries and restores them on reload", () => {
		const persistRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-ckpt-persist-"),
		);
		initCheckpointPersistence(persistRoot);

		// Begin + touch a file + finish → summary persisted to disk.
		fs.writeFileSync(path.join(root, "a.txt"), "v1", "utf8");
		const begin = beginCheckpoint("s1", "msg-1", root);
		expect(begin.status).toBe("capturing");
		fs.writeFileSync(path.join(root, "a.txt"), "v2", "utf8");
		noteCheckpointFsChange(root, "a.txt", "change");
		const finished = finishCheckpoint("s1", "msg-1");
		expect(finished.status).toBe("ready");
		expect(finished.fileCount).toBeGreaterThan(0);

		// Simulate app restart: reset in-memory state, re-init from same dir.
		_resetCheckpointsForTests();
		initCheckpointPersistence(persistRoot);
		const restored = listSessionCheckpointSummaries("s1");
		expect(
			restored.some(
				(s) =>
					s.userMessageId === "msg-1" &&
					s.status === "ready" &&
					s.fileCount > 0,
			),
		).toBe(true);

		fs.rmSync(persistRoot, { recursive: true, force: true });
	});
});

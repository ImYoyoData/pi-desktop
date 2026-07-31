import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  ensureSessionFileOnDisk,
  openExistingSessionFile,
} from "../../src/agent-worker/session-file";

describe("ensureSessionFileOnDisk", () => {
  it("writes header so cold reopen keeps the same session id", () => {
    const root = mkdtempSync(path.join(tmpdir(), "pi-sess-persist-"));
    const cwd = path.join(root, "project");
    mkdirSync(cwd);
    const sm = SessionManager.create(cwd, path.join(root, "sessions"));
    const id = sm.getSessionId();
    const file = sm.getSessionFile();
    expect(file).toBeTruthy();
    expect(existsSync(file!)).toBe(false);

    ensureSessionFileOnDisk(sm);

    expect(existsSync(file!)).toBe(true);
    expect(sm.getSessionId()).toBe(id);
    const raw = readFileSync(file!, "utf8");
    expect(raw).toContain(id);

    const reopened = openExistingSessionFile(SessionManager, file!, cwd);
    expect(reopened.getSessionId()).toBe(id);
  });
});

describe("openExistingSessionFile", () => {
  it("throws when the session file is missing (does not invent a new id)", () => {
    const root = mkdtempSync(path.join(tmpdir(), "pi-sess-missing-"));
    const missing = path.join(root, "nope.jsonl");
    expect(() => openExistingSessionFile(SessionManager, missing, root)).toThrow(
      /session file not found/,
    );
  });

  it("opens an existing file and returns its header id", () => {
    const root = mkdtempSync(path.join(tmpdir(), "pi-sess-open-"));
    const cwd = path.join(root, "project");
    mkdirSync(cwd);
    const created = SessionManager.create(cwd, path.join(root, "sessions"));
    ensureSessionFileOnDisk(created);
    const file = created.getSessionFile()!;
    const id = created.getSessionId();

    // Simulate Pi's dangerous missing-file behavior for contrast is covered above.
    writeFileSync(file, readFileSync(file, "utf8"), "utf8");
    const opened = openExistingSessionFile(SessionManager, file, cwd);
    expect(opened.getSessionId()).toBe(id);
  });
});

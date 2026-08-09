import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  encodeCwdSessionDir,
  listPiCliWorkspaces,
  listSessionsForCwd,
  mergeRecentWithPiCliWorkspaces,
  normalizeWorkspacePath,
  purgeWorkspaceSessionDir,
} from "../../src/main/session-list";

const CURRENT_SESSION_VERSION = 3;

function writeSessionHeader(filePath: string, id: string, cwd: string, modifiedIso?: string): void {
  const line = JSON.stringify({
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id,
    timestamp: modifiedIso ?? "2026-01-15T12:00:00.000Z",
    cwd,
  });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${line}\n`, "utf8");
  if (modifiedIso) {
    const t = new Date(modifiedIso).getTime() / 1000;
    fs.utimesSync(filePath, t, t);
  }
}

describe("session-list", () => {
  let tempRoot: string;
  let previousAgentDir: string | undefined;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desktop-sessions-"));
    previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = tempRoot;
  });

  afterEach(() => {
    if (previousAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("returns only sessions for the requested cwd", async () => {
    const cwdA = path.join(tempRoot, "project-a");
    const cwdB = path.join(tempRoot, "project-b");
    fs.mkdirSync(cwdA, { recursive: true });
    fs.mkdirSync(cwdB, { recursive: true });

    const dirA = encodeCwdSessionDir(cwdA);
    const dirB = encodeCwdSessionDir(cwdB);

    writeSessionHeader(path.join(dirA, "2026-01-15T12-00-00-000Z_session-a.jsonl"), "session-a", cwdA);
    writeSessionHeader(path.join(dirB, "2026-01-15T12-00-00-000Z_session-b.jsonl"), "session-b", cwdB);

    const listed = await listSessionsForCwd(cwdA);

    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe("session-a");
    expect(path.resolve(listed[0]!.cwd)).toBe(path.resolve(cwdA));
  });

  it("lists workspaces discovered from Pi CLI sessions", async () => {
    const cwdA = path.join(tempRoot, "ws-a");
    const cwdB = path.join(tempRoot, "ws-b");
    fs.mkdirSync(cwdA, { recursive: true });
    fs.mkdirSync(cwdB, { recursive: true });

    writeSessionHeader(
      path.join(encodeCwdSessionDir(cwdA), "2026-01-15T12-00-00-000Z_a.jsonl"),
      "a",
      cwdA,
      "2026-01-15T12:00:00.000Z",
    );
    writeSessionHeader(
      path.join(encodeCwdSessionDir(cwdB), "2026-01-16T12-00-00-000Z_b.jsonl"),
      "b",
      cwdB,
      "2026-01-16T12:00:00.000Z",
    );

    const workspaces = await listPiCliWorkspaces();
    expect(workspaces.map((p) => normalizeWorkspacePath(p))).toEqual(
      [cwdB, cwdA].map((p) => normalizeWorkspacePath(p)),
    );
  });

  it("merges desktop recent ahead of pi-discovered workspaces and respects dismiss", async () => {
    const cwdA = path.join(tempRoot, "merge-a");
    const cwdB = path.join(tempRoot, "merge-b");
    fs.mkdirSync(cwdA, { recursive: true });
    fs.mkdirSync(cwdB, { recursive: true });
    writeSessionHeader(path.join(encodeCwdSessionDir(cwdA), "a.jsonl"), "a", cwdA);
    writeSessionHeader(path.join(encodeCwdSessionDir(cwdB), "b.jsonl"), "b", cwdB);

    const merged = await mergeRecentWithPiCliWorkspaces([cwdB], [cwdA]);
    expect(merged.map(normalizeWorkspacePath)).toEqual([normalizeWorkspacePath(cwdB)]);
  });

  it("purgeWorkspaceSessionDir removes Pi sessions but keeps the project folder", async () => {
    const cwd = path.join(tempRoot, "purge-me");
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(path.join(cwd, "README.md"), "keep me\n", "utf8");
    const sessionDir = encodeCwdSessionDir(cwd);
    writeSessionHeader(path.join(sessionDir, "s.jsonl"), "s", cwd);
    expect(fs.existsSync(sessionDir)).toBe(true);

    await purgeWorkspaceSessionDir(cwd);

    expect(fs.existsSync(sessionDir)).toBe(false);
    expect(fs.existsSync(path.join(cwd, "README.md"))).toBe(true);
    expect(await listSessionsForCwd(cwd)).toEqual([]);
  });
});

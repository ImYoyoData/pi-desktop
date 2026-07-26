import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encodeCwdSessionDir, listSessionsForCwd } from "../../src/main/session-list";

const CURRENT_SESSION_VERSION = 3;

function writeSessionHeader(filePath: string, id: string, cwd: string): void {
  const line = JSON.stringify({
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id,
    timestamp: "2026-01-15T12:00:00.000Z",
    cwd,
  });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${line}\n`, "utf8");
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
    expect(listed[0]?.cwd).toBe(cwdA);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getWorkspaceGitStatus } from "../../src/main/git-host";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("git-host dugite smoke", () => {
  it("init + status works via embedded git (platform-native dugite binary)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-git-host-"));
    temps.push(dir);

    const { initRepo } = await import("../../src/main/git-host");
    const init = await initRepo(dir);
    expect(init.ok).toBe(true);

    const status = await getWorkspaceGitStatus(dir);
    expect(status.isGitRepository).toBe(true);
    expect(status.files).toEqual([]);
  }, 60_000);
});

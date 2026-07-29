import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getWorkspaceGitStatus,
  initRepo,
  listBranches,
  restorePaths,
} from "../../src/main/git-host";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  // Prefer PATH git for test scaffolding; dugite is used by git-host itself.
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" },
  });
  return stdout;
}

describe("git-host dugite smoke", () => {
  it("init + status works via embedded git (platform-native dugite binary)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-git-host-"));
    temps.push(dir);

    const init = await initRepo(dir);
    expect(init.ok).toBe(true);

    const status = await getWorkspaceGitStatus(dir);
    expect(status.isGitRepository).toBe(true);
    expect(status.files).toEqual([]);
  }, 60_000);

  it("restorePaths discards tracked edits and deletes untracked files", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-git-restore-"));
    temps.push(dir);

    expect((await initRepo(dir)).ok).toBe(true);
    fs.writeFileSync(path.join(dir, "tracked.txt"), "v1\n", "utf8");
    await runGit(dir, ["add", "tracked.txt"]);
    await runGit(dir, ["commit", "-m", "init"]);

    fs.writeFileSync(path.join(dir, "tracked.txt"), "v2\n", "utf8");
    fs.writeFileSync(path.join(dir, "new.txt"), "scratch\n", "utf8");

    const before = await getWorkspaceGitStatus(dir);
    expect(before.files.map((f) => f.relativePath).sort()).toEqual(["new.txt", "tracked.txt"]);

    const restored = await restorePaths(dir, ["tracked.txt", "new.txt"]);
    expect(restored.ok).toBe(true);

    expect(fs.readFileSync(path.join(dir, "tracked.txt"), "utf8").replace(/\r\n/g, "\n")).toBe(
      "v1\n",
    );
    expect(fs.existsSync(path.join(dir, "new.txt"))).toBe(false);

    const after = await getWorkspaceGitStatus(dir);
    expect(after.files).toEqual([]);
  }, 60_000);

  it("listBranches includes remote-tracking refs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-git-branches-"));
    temps.push(dir);
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), "pi-git-remote-"));
    temps.push(remote);

    expect((await initRepo(dir)).ok).toBe(true);
    fs.writeFileSync(path.join(dir, "a.txt"), "a\n", "utf8");
    await runGit(dir, ["add", "a.txt"]);
    await runGit(dir, ["commit", "-m", "init"]);

    await runGit(remote, ["init", "--bare"]);
    await runGit(dir, ["remote", "add", "origin", remote]);
    await runGit(dir, ["push", "-u", "origin", "HEAD"]);

    const branches = await listBranches(dir);
    expect(branches.local.length).toBeGreaterThan(0);
    expect(branches.remote.some((name) => name.startsWith("origin/"))).toBe(true);
  }, 60_000);
});

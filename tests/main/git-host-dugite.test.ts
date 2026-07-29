import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  abortMerge,
  checkoutConflictSide,
  getConflictContent,
  getWorkspaceGitStatus,
  initRepo,
  listBranches,
  resolveConflictPath,
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

async function runGitAllowFail(cwd: string, args: string[]): Promise<boolean> {
  try {
    await runGit(cwd, args);
    return true;
  } catch {
    return false;
  }
}

async function defaultBranchName(cwd: string): Promise<string> {
  return (await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
}

async function mergeHeadExists(cwd: string): Promise<boolean> {
  const gitDir = (await runGit(cwd, ["rev-parse", "--git-dir"])).trim();
  const absGitDir = path.isAbsolute(gitDir) ? gitDir : path.join(cwd, gitDir);
  return fs.existsSync(path.join(absGitDir, "MERGE_HEAD"));
}

async function makeConflictRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-git-conflict-"));
  temps.push(dir);

  expect((await initRepo(dir)).ok).toBe(true);

  fs.writeFileSync(path.join(dir, "f.txt"), "base\n", "utf8");
  await runGit(dir, ["add", "f.txt"]);
  await runGit(dir, ["commit", "-m", "base"]);
  const main = await defaultBranchName(dir);

  await runGit(dir, ["checkout", "-b", "feature"]);
  fs.writeFileSync(path.join(dir, "f.txt"), "feature\n", "utf8");
  await runGit(dir, ["add", "f.txt"]);
  await runGit(dir, ["commit", "-m", "feature"]);

  await runGit(dir, ["checkout", main]);
  fs.writeFileSync(path.join(dir, "f.txt"), "mainline\n", "utf8");
  await runGit(dir, ["add", "f.txt"]);
  await runGit(dir, ["commit", "-m", "mainline"]);

  expect(await runGitAllowFail(dir, ["merge", "feature"])).toBe(false);

  return dir;
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

  it("resolveConflictPath clears merge conflict after writing merged content", async () => {
    const dir = await makeConflictRepo();

    const content = await getConflictContent(dir, "f.txt");
    expect(content.supported).toBe(true);
    if (!content.supported) return;
    expect(content.working).toContain("<<<<<<<");
    expect(content.ours).toContain("mainline");
    expect(content.theirs).toContain("feature");

    const resolved = await resolveConflictPath(dir, "f.txt", "merged\n");
    expect(resolved.ok).toBe(true);
    const status = await getWorkspaceGitStatus(dir);
    expect(status.files.every((f) => f.code !== "C")).toBe(true);
  }, 60_000);

  it("checkoutConflictSide stages ours", async () => {
    const dir = await makeConflictRepo();

    const ours = await getConflictContent(dir, "f.txt");
    expect(ours.supported).toBe(true);
    if (!ours.supported) return;

    const picked = await checkoutConflictSide(dir, "f.txt", "ours");
    expect(picked.ok).toBe(true);

    const status = await getWorkspaceGitStatus(dir);
    expect(status.files.every((f) => f.code !== "C")).toBe(true);
    expect(fs.readFileSync(path.join(dir, "f.txt"), "utf8").replace(/\r\n/g, "\n")).toBe(
      ours.ours.replace(/\r\n/g, "\n"),
    );
  }, 60_000);

  it("abortMerge restores clean state", async () => {
    const dir = await makeConflictRepo();
    expect(await mergeHeadExists(dir)).toBe(true);

    const aborted = await abortMerge(dir);
    expect(aborted.ok).toBe(true);

    const status = await getWorkspaceGitStatus(dir);
    expect(status.isGitRepository).toBe(true);
    expect(status.files.every((f) => f.code !== "C")).toBe(true);
    expect(await mergeHeadExists(dir)).toBe(false);
  }, 60_000);
});

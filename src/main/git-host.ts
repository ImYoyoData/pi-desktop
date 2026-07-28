import fs from "node:fs";
import path from "node:path";
import { ExecError, exec } from "dugite";
import type {
  GitErrorCode,
  GitLogEntry,
  GitLogResult,
  GitOpResult,
  GitRemote,
} from "../shared/git-types";
import { classifyGitFailure, detailFromGitOutput, isEmbeddedGitMissing } from "./git-errors";

const GIT_TIMEOUT_MS = 60_000;
const GIT_STATUS_MAX_BUFFER = 8 * 1024 * 1024;
const TEXT_PREVIEW_MAX_BYTES = 1.5 * 1024 * 1024;
const GIT_LOG_DEFAULT_LIMIT = 50;

export type GitFileStatusKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflict";

export type GitStatusCode = "M" | "A" | "D" | "R" | "U" | "C";

export type GitFileStatus = {
  /** Relative path from workspace root, `/` separators */
  relativePath: string;
  status: GitFileStatusKind;
  code: GitStatusCode;
};

export type GitStatusResult = {
  isGitRepository: boolean;
  branch: string | null;
  files: GitFileStatus[];
  /** Present when status could not run (e.g. dugite binary missing). */
  errorCode?: GitErrorCode;
  errorMessage?: string;
};

export type GitFileDiffResult = {
  supported: boolean;
  status?: GitFileStatusKind;
  patch?: string;
  /** File content at HEAD (empty for new/untracked). */
  oldContent?: string | null;
  /** Working-tree content (empty for deleted). */
  newContent?: string | null;
};

export type GitBranchesResult = {
  current: string | null;
  local: string[];
};

export type { GitOpResult, GitRemote, GitLogEntry, GitLogResult, GitErrorCode };

type PorcelainEntry = {
  path: string;
  originalPath?: string;
  indexStatus: string;
  worktreeStatus: string;
};

type GitFail = { ok: false; message: string; code: GitErrorCode; stdout: string; stderr: string };

function fail(code: GitErrorCode, detail = ""): GitOpResult {
  return { ok: false, code, message: detail.trim() || code };
}

function toText(value: string | Buffer): string {
  return typeof value === "string" ? value : value.toString("utf8");
}

async function git(
  cwd: string,
  args: string[],
  maxBuffer = GIT_STATUS_MAX_BUFFER,
): Promise<string> {
  try {
    const result = await exec(args, cwd, {
      maxBuffer,
      env: { ...process.env, LC_ALL: "C" },
      signal: AbortSignal.timeout(GIT_TIMEOUT_MS),
    });
    const stdout = toText(result.stdout);
    const stderr = toText(result.stderr);
    if (result.exitCode !== 0) {
      const message =
        detailFromGitOutput(stderr, stdout) || `git ${args[0] ?? "command"} failed`;
      const err = new Error(message) as Error & {
        stderr: string;
        stdout: string;
        exitCode: number;
      };
      err.stderr = stderr;
      err.stdout = stdout;
      err.exitCode = result.exitCode;
      throw err;
    }
    return stdout;
  } catch (err) {
    if (err instanceof ExecError) {
      const stderr = toText(err.stderr);
      const stdout = toText(err.stdout);
      const message =
        detailFromGitOutput(stderr, stdout) || err.message || "git executable failed";
      const wrapped = new Error(message) as Error & {
        stderr: string;
        stdout: string;
      };
      wrapped.stderr = stderr;
      wrapped.stdout = stdout;
      throw wrapped;
    }
    throw err;
  }
}

async function gitAllowFail(
  cwd: string,
  args: string[],
): Promise<{ ok: true; stdout: string } | GitFail> {
  try {
    const stdout = await git(cwd, args);
    return { ok: true, stdout };
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const stderr = (e.stderr || "").trim();
    const stdout = (e.stdout || "").trim();
    const detail = detailFromGitOutput(stderr, stdout) || (e.message || "git command failed").trim();
    return {
      ok: false,
      message: detail,
      code: classifyGitFailure(stderr || detail, stdout),
      stdout,
      stderr,
    };
  }
}

function parsePorcelainV1(output: string): PorcelainEntry[] {
  const records = output.split("\0");
  const entries: PorcelainEntry[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record || record.length < 4 || record[2] !== " ") continue;
    const indexStatus = record[0];
    const worktreeStatus = record[1];
    const entry: PorcelainEntry = {
      path: record.slice(3),
      indexStatus,
      worktreeStatus,
    };
    if (
      indexStatus === "R" ||
      indexStatus === "C" ||
      worktreeStatus === "R" ||
      worktreeStatus === "C"
    ) {
      entry.originalPath = records[++i] || undefined;
    }
    entries.push(entry);
  }
  return entries;
}

const CONFLICT = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

export function classify(entry: PorcelainEntry): Pick<GitFileStatus, "status" | "code"> {
  const pair = `${entry.indexStatus}${entry.worktreeStatus}`;
  if (pair === "??") return { status: "untracked", code: "U" };
  if (CONFLICT.has(pair) || pair.includes("U")) return { status: "conflict", code: "C" };
  if (pair.includes("D")) return { status: "deleted", code: "D" };
  if (pair.includes("R") || pair.includes("C")) return { status: "renamed", code: "R" };
  if (pair.includes("A")) return { status: "added", code: "A" };
  return { status: "modified", code: "M" };
}

function isWithin(parent: string, target: string): boolean {
  const rel = path.relative(realpathSafe(parent), realpathSafe(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Prefer realpath so macOS /var ↔ /private/var (and similar) comparisons match. */
function realpathSafe(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  }
}

function toGitPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

async function findRepositoryRoot(cwd: string): Promise<string | null> {
  try {
    const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
    return root ? realpathSafe(root) : null;
  } catch (err) {
    if (isEmbeddedGitMissing(err)) throw err;
    return null;
  }
}

function hasLocalGitDir(cwd: string): boolean {
  try {
    return fs.existsSync(path.join(cwd, ".git"));
  } catch {
    return false;
  }
}

async function readStatusEntries(repositoryRoot: string): Promise<PorcelainEntry[]> {
  const output = await git(repositoryRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  return parsePorcelainV1(output);
}

export async function getWorkspaceGitStatus(cwd: string): Promise<GitStatusResult> {
  let repositoryRoot: string | null;
  try {
    repositoryRoot = await findRepositoryRoot(cwd);
  } catch (err) {
    if (isEmbeddedGitMissing(err)) {
      return {
        isGitRepository: hasLocalGitDir(cwd),
        branch: null,
        files: [],
        errorCode: "git_unavailable",
        errorMessage:
          "Embedded Git (dugite) is missing. Run: npm run dugite:git",
      };
    }
    throw err;
  }
  if (!repositoryRoot) return { isGitRepository: false, branch: null, files: [] };

  let branch: string | null = null;
  try {
    const name = (await git(repositoryRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    branch = name || null;
    if (branch === "HEAD") {
      const short = (await git(repositoryRoot, ["rev-parse", "--short", "HEAD"])).trim();
      branch = short ? `detached@${short}` : "HEAD";
    }
  } catch {
    branch = null;
  }

  let entries: PorcelainEntry[];
  try {
    entries = await readStatusEntries(repositoryRoot);
  } catch {
    return { isGitRepository: true, branch, files: [] };
  }

  const files: GitFileStatus[] = [];
  for (const entry of entries) {
    const abs = path.resolve(repositoryRoot, entry.path);
    if (!isWithin(cwd, abs)) continue;
    const relativePath = path.relative(cwd, abs).split(path.sep).join("/");
    if (!relativePath || relativePath.startsWith("..")) continue;
    files.push({ relativePath, ...classify(entry) });
  }
  return { isGitRepository: true, branch, files };
}

function hasNullByte(content: Buffer): boolean {
  return content.includes(0);
}

function createAddedFilePatch(gitPath: string, content: string): string {
  const hasTrailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (hasTrailingNewline) lines.pop();
  const body = lines.map((line) => `+${line}`).join("\n");
  const noNewlineMarker =
    !hasTrailingNewline && lines.length > 0 ? "\n\\ No newline at end of file" : "";
  return [
    `diff --git a/${gitPath} b/${gitPath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${gitPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    `${body}${noNewlineMarker}`,
  ].join("\n");
}

async function createTrackedFilePatch(
  repositoryRoot: string,
  relativePath: string,
  originalPath?: string,
): Promise<string | null> {
  const paths =
    originalPath && originalPath !== relativePath
      ? [originalPath, relativePath]
      : [relativePath];
  try {
    return await git(
      repositoryRoot,
      ["diff", "--no-color", "--no-ext-diff", "--unified=3", "HEAD", "--", ...paths],
      TEXT_PREVIEW_MAX_BYTES * 4,
    );
  } catch {
    return null;
  }
}

/** Read file content at HEAD; null if path did not exist in HEAD. */
async function readHeadContent(
  repositoryRoot: string,
  gitPath: string,
): Promise<string | null> {
  try {
    return await git(
      repositoryRoot,
      ["show", `HEAD:${gitPath}`],
      TEXT_PREVIEW_MAX_BYTES,
    );
  } catch {
    return null;
  }
}

export async function getGitFileDiff(
  cwd: string,
  relativePath: string,
): Promise<GitFileDiffResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return { supported: false };

  const resolvedFilePath = path.resolve(cwd, relativePath);
  if (!isWithin(cwd, resolvedFilePath) || !isWithin(repositoryRoot, resolvedFilePath)) {
    return { supported: false };
  }

  const repoRelative = toGitPath(path.relative(repositoryRoot, resolvedFilePath));
  let entries: PorcelainEntry[];
  try {
    entries = await readStatusEntries(repositoryRoot);
  } catch {
    return { supported: false };
  }
  const entry = entries.find((c) => c.path === repoRelative);
  if (!entry) return { supported: false };

  const { status } = classify(entry);
  if (status === "deleted") {
    try {
      const headPath = entry.originalPath || repoRelative;
      const patch = await git(repositoryRoot, [
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--unified=3",
        "HEAD",
        "--",
        headPath,
      ]);
      if (!patch.includes("\n@@ ") && !patch.startsWith("@@ ")) return { supported: false };
      const oldContent = (await readHeadContent(repositoryRoot, headPath)) ?? "";
      return { supported: true, status, patch, oldContent, newContent: "" };
    } catch {
      return { supported: false };
    }
  }

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolvedFilePath);
  } catch {
    return { supported: false };
  }
  if (!stat.isFile() || stat.size > TEXT_PREVIEW_MAX_BYTES) return { supported: false };

  const currentBuffer = fs.readFileSync(resolvedFilePath);
  if (hasNullByte(currentBuffer)) return { supported: false };
  const newContent = currentBuffer.toString("utf8");

  let patch: string;
  let oldContent = "";
  if (status === "untracked") {
    patch = createAddedFilePatch(repoRelative, newContent);
  } else {
    const headPath = entry.originalPath || repoRelative;
    oldContent = (await readHeadContent(repositoryRoot, headPath)) ?? "";
    // Brand-new tracked/staged file: treat as full addition (empty at HEAD).
    if (!oldContent) {
      patch = createAddedFilePatch(repoRelative, newContent);
      oldContent = "";
    } else {
      const trackedPatch = await createTrackedFilePatch(
        repositoryRoot,
        repoRelative,
        entry.originalPath,
      );
      if (trackedPatch === null || (!trackedPatch.includes("\n@@ ") && !trackedPatch.startsWith("@@ "))) {
        if (status === "added") {
          patch = createAddedFilePatch(repoRelative, newContent);
          oldContent = "";
        } else {
          return { supported: false };
        }
      } else {
        patch = trackedPatch;
      }
    }
  }

  if (!patch.includes("\n@@ ") && !patch.startsWith("@@ ")) return { supported: false };
  return { supported: true, status, patch, oldContent, newContent };
}

export async function listBranches(cwd: string): Promise<GitBranchesResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return { current: null, local: [] };

  let current: string | null = null;
  try {
    current = (await git(repositoryRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).trim() || null;
  } catch {
    current = null;
  }

  try {
    const out = await git(repositoryRoot, ["branch", "--format=%(refname:short)"]);
    const local = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return { current, local };
  } catch {
    return { current, local: [] };
  }
}

export async function checkoutBranch(cwd: string, branch: string): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return fail("not_repo", "Not a git repository");
  const name = branch.trim();
  if (!name) return fail("invalid_args", "Branch name required");
  const result = await gitAllowFail(repositoryRoot, ["checkout", name]);
  if (!result.ok) return fail(result.code, result.message);
  return { ok: true };
}

export async function createBranch(cwd: string, branch: string): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return fail("not_repo", "Not a git repository");
  const name = branch.trim();
  if (!name) return fail("invalid_args", "Branch name required");
  const result = await gitAllowFail(repositoryRoot, ["checkout", "-b", name]);
  if (!result.ok) return fail(result.code, result.message);
  return { ok: true };
}

export async function mergeBranch(cwd: string, branch: string): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return fail("not_repo", "Not a git repository");
  const name = branch.trim();
  if (!name) return fail("invalid_args", "Branch name required");
  const result = await gitAllowFail(repositoryRoot, ["merge", name]);
  if (!result.ok) return fail(result.code, result.message);
  return { ok: true, message: result.stdout.trim() || undefined };
}

export async function commitPaths(
  cwd: string,
  message: string,
  relativePaths: string[],
): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return fail("not_repo", "Not a git repository");
  const msg = message.trim();
  if (!msg) return fail("invalid_args", "Commit message required");
  if (!relativePaths.length) return fail("invalid_args", "No files selected");

  const repoPaths: string[] = [];
  for (const rel of relativePaths) {
    const abs = path.resolve(cwd, rel);
    if (!isWithin(cwd, abs) || !isWithin(repositoryRoot, abs)) {
      return fail("invalid_args", `Path outside workspace: ${rel}`);
    }
    repoPaths.push(toGitPath(path.relative(repositoryRoot, abs)));
  }

  const add = await gitAllowFail(repositoryRoot, ["add", "--", ...repoPaths]);
  if (!add.ok) return fail(add.code, add.message);
  const commit = await gitAllowFail(repositoryRoot, ["commit", "-m", msg]);
  if (!commit.ok) return fail(commit.code, commit.message);
  return { ok: true };
}

export async function initRepo(cwd: string): Promise<GitOpResult> {
  const existing = await findRepositoryRoot(cwd);
  if (existing && realpathSafe(existing) === realpathSafe(cwd)) {
    return fail("invalid_args", "Already a git repository");
  }
  const result = await gitAllowFail(cwd, ["init"]);
  if (!result.ok) return fail(result.code, result.message);
  return { ok: true, message: result.stdout.trim() || undefined };
}

async function readRemotes(repositoryRoot: string): Promise<GitRemote[]> {
  const out = await git(repositoryRoot, ["remote", "-v"]);
  const map = new Map<string, GitRemote>();
  for (const line of out.split(/\r?\n/)) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!match) continue;
    const [, name, url, kind] = match;
    const current = map.get(name) ?? { name, fetchUrl: "", pushUrl: "" };
    if (kind === "fetch") current.fetchUrl = url;
    else current.pushUrl = url;
    map.set(name, current);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listRemotes(cwd: string): Promise<GitRemote[]> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return [];
  try {
    return await readRemotes(repositoryRoot);
  } catch {
    return [];
  }
}

export async function addRemote(
  cwd: string,
  name: string,
  url: string,
): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return fail("not_repo", "Not a git repository");
  const remoteName = name.trim();
  const remoteUrl = url.trim();
  if (!remoteName || !remoteUrl) return fail("invalid_args", "Remote name and URL required");
  const result = await gitAllowFail(repositoryRoot, ["remote", "add", remoteName, remoteUrl]);
  if (!result.ok) return fail(result.code, result.message);
  return { ok: true };
}

export async function setRemoteUrl(
  cwd: string,
  name: string,
  url: string,
): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return fail("not_repo", "Not a git repository");
  const remoteName = name.trim();
  const remoteUrl = url.trim();
  if (!remoteName || !remoteUrl) return fail("invalid_args", "Remote name and URL required");
  const result = await gitAllowFail(repositoryRoot, [
    "remote",
    "set-url",
    remoteName,
    remoteUrl,
  ]);
  if (!result.ok) return fail(result.code, result.message);
  return { ok: true };
}

export async function removeRemote(cwd: string, name: string): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return fail("not_repo", "Not a git repository");
  const remoteName = name.trim();
  if (!remoteName) return fail("invalid_args", "Remote name required");
  const result = await gitAllowFail(repositoryRoot, ["remote", "remove", remoteName]);
  if (!result.ok) return fail(result.code, result.message);
  return { ok: true };
}

export async function listLog(
  cwd: string,
  limit = GIT_LOG_DEFAULT_LIMIT,
): Promise<GitLogResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return { entries: [] };
  const n = Math.max(1, Math.min(200, Math.floor(limit) || GIT_LOG_DEFAULT_LIMIT));
  try {
    const out = await git(repositoryRoot, [
      "log",
      `-n${n}`,
      "--pretty=format:%H%x00%h%x00%an%x00%aI%x00%s%x00",
    ]);
    const entries: GitLogEntry[] = [];
    const parts = out.split("\0");
    for (let i = 0; i + 4 < parts.length; i += 5) {
      const hash = parts[i]?.trim();
      if (!hash) continue;
      entries.push({
        hash,
        shortHash: parts[i + 1]?.trim() || hash.slice(0, 7),
        author: parts[i + 2]?.trim() || "",
        date: parts[i + 3]?.trim() || "",
        subject: parts[i + 4]?.trim() || "",
      });
    }
    return { entries };
  } catch {
    return { entries: [] };
  }
}

export async function pullRepo(cwd: string): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return fail("not_repo", "Not a git repository");

  let remotes: GitRemote[] = [];
  try {
    remotes = await readRemotes(repositoryRoot);
  } catch {
    remotes = [];
  }
  if (!remotes.length) {
    return fail("no_remote", "No remotes configured. Add origin (or another remote) first.");
  }

  const rebase = await gitAllowFail(repositoryRoot, ["pull", "--rebase"]);
  if (rebase.ok) return { ok: true, message: rebase.stdout.trim() || undefined };
  if (rebase.code === "conflicts") return fail("conflicts", rebase.message);

  const plain = await gitAllowFail(repositoryRoot, ["pull"]);
  if (plain.ok) return { ok: true, message: plain.stdout.trim() || undefined };
  return fail(plain.code !== "unknown" ? plain.code : rebase.code, plain.message || rebase.message);
}

export async function pushRepo(cwd: string): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return fail("not_repo", "Not a git repository");

  let remotes: GitRemote[] = [];
  try {
    remotes = await readRemotes(repositoryRoot);
  } catch {
    remotes = [];
  }
  if (!remotes.length) {
    return fail("no_remote", "No remotes configured. Add origin (or another remote) first.");
  }

  const push = await gitAllowFail(repositoryRoot, ["push"]);
  if (push.ok) return { ok: true, message: push.stdout.trim() || undefined };
  if (push.code !== "no_upstream" && push.code !== "unknown") {
    return fail(push.code, push.message);
  }

  let branch = "";
  try {
    branch = (await git(repositoryRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  } catch {
    return fail(push.code, push.message);
  }
  if (!branch || branch === "HEAD") return fail(push.code, push.message);

  const origin = remotes.find((r) => r.name === "origin") ?? remotes[0];
  const upstream = await gitAllowFail(repositoryRoot, [
    "push",
    "-u",
    origin.name,
    branch,
  ]);
  if (upstream.ok) return { ok: true, message: upstream.stdout.trim() || undefined };
  return fail(upstream.code, upstream.message || push.message);
}

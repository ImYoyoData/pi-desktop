import fs from "node:fs";
import path from "node:path";
import { ExecError, exec } from "dugite";
import type {
  GitConflictContentResult,
  GitErrorCode,
  GitLogEntry,
  GitLogResult,
  GitOpResult,
  GitRemote,
} from "../shared/git-types";
import { classifyGitFailure, detailFromGitOutput, isEmbeddedGitMissing } from "./git-errors";
import { isGitIgnoredPath } from "./git-ignore-store";

/** Quick local ops (status / diff / branch). */
const GIT_TIMEOUT_MS = 30_000;
/** Commits can wait on GPG signing / pre-commit hooks. */
const GIT_COMMIT_TIMEOUT_MS = 120_000;
/** Network ops (fetch / pull / push) need a lot longer than local ones. */
const GIT_NETWORK_TIMEOUT_MS = 10 * 60_000;
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
  /** True when changes are staged in the index. */
  staged: boolean;
  /** True when the file matches the workspace ignore/filter list. */
  ignored: boolean;
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
  /** Remote-tracking refs like `origin/main` (excludes `origin/HEAD`). */
  remote: string[];
};

export type { GitOpResult, GitRemote, GitLogEntry, GitLogResult, GitErrorCode, GitConflictContentResult };

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

/**
 * Serialize every git subprocess. Concurrent `git status` refreshes and user
 * operations (commit / push / checkout) used to race on .git/index.lock and fail
 * with "Unable to create index.lock: File exists" even though the exact same
 * command succeeds in a native terminal.
 */
let gitChain: Promise<void> = Promise.resolve();
function enqueueGit<T>(fn: () => Promise<T>): Promise<T> {
  const run = gitChain.then(fn, fn);
  gitChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function git(
  cwd: string,
  args: string[],
  maxBuffer = GIT_STATUS_MAX_BUFFER,
  timeoutMs = GIT_TIMEOUT_MS,
): Promise<string> {
  return enqueueGit(() => gitSpawn(cwd, args, maxBuffer, timeoutMs));
}

async function gitSpawn(
  cwd: string,
  args: string[],
  maxBuffer = GIT_STATUS_MAX_BUFFER,
  timeoutMs = GIT_TIMEOUT_MS,
): Promise<string> {
  try {
    const result = await exec(args, cwd, {
      maxBuffer,
      env: { ...process.env, LC_ALL: "C" },
      signal: AbortSignal.timeout(timeoutMs),
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
  timeoutMs = GIT_TIMEOUT_MS,
): Promise<{ ok: true; stdout: string } | GitFail> {
  try {
    const stdout = await git(cwd, args, GIT_STATUS_MAX_BUFFER, timeoutMs);
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
    const ignored = isGitIgnoredPath(cwd, relativePath);
    // Filtered files are hidden from the Changes list entirely.
    if (ignored) continue;
    files.push({
      relativePath,
      ...classify(entry),
      staged: entry.indexStatus !== " " && entry.indexStatus !== "?",
      ignored: false,
    });
  }
  return { isGitRepository: true, branch, files };
}

function hasNullByte(content: Buffer): boolean {
  return content.includes(0);
}

function stageTextRejectReason(text: string): "binary" | "too_large" | null {
  const buf = Buffer.from(text, "utf8");
  if (buf.length > TEXT_PREVIEW_MAX_BYTES) return "too_large";
  if (hasNullByte(buf)) return "binary";
  return null;
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
  if (!repositoryRoot) return { current: null, local: [], remote: [] };

  let current: string | null = null;
  try {
    current = (await git(repositoryRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).trim() || null;
  } catch {
    current = null;
  }

  let local: string[] = [];
  try {
    const out = await git(repositoryRoot, ["branch", "--format=%(refname:short)"]);
    local = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    local = [];
  }

  let remote: string[] = [];
  try {
    const out = await git(repositoryRoot, ["branch", "-r", "--format=%(refname:short)"]);
    remote = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((name) => Boolean(name) && !name.endsWith("/HEAD"));
  } catch {
    remote = [];
  }

  return { current, local, remote };
}

/**
 * Discard working-tree / index changes for paths.
 * Tracked → `git restore --staged --worktree`; untracked → `git clean -f --`.
 */
export async function restorePaths(
  cwd: string,
  relativePaths: string[],
): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return fail("not_repo", "Not a git repository");
  if (!relativePaths.length) return fail("invalid_args", "No files selected");

  const tracked: string[] = [];
  const untracked: string[] = [];

  const gitPaths: string[] = [];
  for (const rel of relativePaths) {
    const abs = path.resolve(cwd, rel);
    if (!isWithin(cwd, abs) || !isWithin(repositoryRoot, abs)) {
      return fail("invalid_args", `Path outside workspace: ${rel}`);
    }
    gitPaths.push(toGitPath(path.relative(repositoryRoot, abs)));
  }

  // One batch call instead of one subprocess per file.
  const trackedSet = new Set<string>();
  if (gitPaths.length) {
    const listing = await gitAllowFail(repositoryRoot, [
      "ls-files",
      "-z",
      "--",
      ...gitPaths,
    ]);
    if (listing.ok) {
      for (const item of listing.stdout.split(" ")) {
        if (item) trackedSet.add(item);
      }
    }
  }
  for (const gitPath of gitPaths) {
    if (trackedSet.has(gitPath)) tracked.push(gitPath);
    else untracked.push(gitPath);
  }

  if (tracked.length) {
    // Prefer restore (Git 2.23+); checkout HEAD -- restores index + worktree.
    const restore = await gitAllowFail(repositoryRoot, [
      "restore",
      "--source=HEAD",
      "--staged",
      "--worktree",
      "--",
      ...tracked,
    ]);
    if (!restore.ok) {
      const checkout = await gitAllowFail(repositoryRoot, [
        "checkout",
        "HEAD",
        "--",
        ...tracked,
      ]);
      if (!checkout.ok) return fail(checkout.code, checkout.message || restore.message);
    }
  }

  if (untracked.length) {
    const clean = await gitAllowFail(repositoryRoot, ["clean", "-f", "--", ...untracked]);
    if (!clean.ok) return fail(clean.code, clean.message);
  }

  return { ok: true };
}

export async function fetchRepo(
  cwd: string,
  remote?: string,
): Promise<GitOpResult> {
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

  const name = (remote || "").trim();
  const args = name
    ? ["fetch", name, "--prune"]
    : ["fetch", "--all", "--prune"];
  const result = await gitAllowFail(repositoryRoot, args, GIT_NETWORK_TIMEOUT_MS);
  if (!result.ok) return fail(result.code, result.message);
  return { ok: true, message: result.stdout.trim() || undefined };
}

/** Local changes that would be overwritten by checkout: make the reason actionable. */
function withCheckoutHint(code: GitErrorCode, message: string): string {
  if (code !== "local_changes") return message;
  const hint =
    "Your local changes to some files would be overwritten. Commit or stash them first, then switch branches again.";
  return message ? `${message}\n${hint}` : hint;
}

export async function checkoutBranch(cwd: string, branch: string): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return fail("not_repo", "Not a git repository");
  const name = branch.trim();
  if (!name) return fail("invalid_args", "Branch name required");

  // Remote-tracking ref → create/switch local branch with tracking.
  if (name.includes("/")) {
    const slash = name.indexOf("/");
    const remoteName = name.slice(0, slash);
    const short = name.slice(slash + 1);
    if (remoteName && short && !short.includes(" ")) {
      let remotes: GitRemote[] = [];
      try {
        remotes = await readRemotes(repositoryRoot);
      } catch {
        remotes = [];
      }
      const remoteNames = new Set(remotes.map((r) => r.name));
      const branches = await listBranches(cwd);
      const isRemoteTracking =
        remoteNames.has(remoteName) || branches.remote.includes(name);

      if (isRemoteTracking) {
        if (branches.local.includes(short)) {
          const localCheckout = await gitAllowFail(repositoryRoot, ["switch", short]);
          if (localCheckout.ok) return { ok: true };
          const legacy = await gitAllowFail(repositoryRoot, ["checkout", short]);
          if (legacy.ok) return { ok: true };
          return fail(localCheckout.code, withCheckoutHint(localCheckout.code, localCheckout.message));
        }
        const tracked = await gitAllowFail(repositoryRoot, [
          "switch",
          "-c",
          short,
          "--track",
          name,
        ]);
        if (tracked.ok) return { ok: true };
        // Older git fallback.
        const create = await gitAllowFail(repositoryRoot, [
          "checkout",
          "-b",
          short,
          "--track",
          name,
        ]);
        if (create.ok) return { ok: true };
        return fail(tracked.code, withCheckoutHint(tracked.code, tracked.message));
      }
    }
  }

  const switched = await gitAllowFail(repositoryRoot, ["switch", name]);
  if (switched.ok) return { ok: true };
  const checked = await gitAllowFail(repositoryRoot, ["checkout", name]);
  if (checked.ok) return { ok: true };
  return fail(switched.code, withCheckoutHint(switched.code, switched.message));
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

export async function deleteBranch(cwd: string, branch: string): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return fail("not_repo", "Not a git repository");
  const name = branch.trim();
  if (!name) return fail("invalid_args", "Branch name required");

  const current = await gitAllowFail(repositoryRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (current.ok && current.stdout.trim() === name) {
    return fail(
      "invalid_args",
      "Cannot delete the currently checked-out branch. Switch to another branch first.",
    );
  }
  // Safe delete: git refuses when the branch is not fully merged (use -D to force).
  const result = await gitAllowFail(repositoryRoot, ["branch", "-d", name]);
  if (!result.ok) return fail(result.code, result.message);
  return { ok: true };
}

export async function renameBranch(
  cwd: string,
  branch: string,
  nextName: string,
): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return fail("not_repo", "Not a git repository");
  const from = branch.trim();
  const to = nextName.trim();
  if (!from || !to) return fail("invalid_args", "Branch name required");
  if (from === to) return fail("invalid_args", "New branch name is the same as the current name");
  const result = await gitAllowFail(repositoryRoot, ["branch", "-m", from, to]);
  if (!result.ok) return fail(result.code, result.message);
  return { ok: true };
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
  // Pathspec commit: only the selected paths are committed, so unrelated
  // pre-staged files never sneak in, and "nothing to commit" is accurate.
  const commit = await gitAllowFail(
    repositoryRoot,
    ["commit", "-m", msg, "--", ...repoPaths],
    GIT_COMMIT_TIMEOUT_MS,
  );
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

/** Parse the NUL-delimited pretty log output into commit entries. */
function parseLogOutput(out: string): GitLogEntry[] {
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
  return entries;
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
    return { entries: parseLogOutput(out) };
  } catch {
    return { entries: [] };
  }
}

/** Commit history restricted to one workspace-relative file. */
export async function logFile(
  cwd: string,
  relativePath: string,
  limit = 50,
): Promise<GitLogResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return { entries: [] };
  const abs = path.resolve(cwd, relativePath);
  if (!isWithin(cwd, abs) || !isWithin(repositoryRoot, abs)) {
    return { entries: [] };
  }
  const gitPath = toGitPath(path.relative(repositoryRoot, abs));
  const n = Math.max(1, Math.min(200, Math.floor(limit) || 50));
  try {
    const out = await git(repositoryRoot, [
      "log",
      `-n${n}`,
      "--pretty=format:%H%x00%h%x00%an%x00%aI%x00%s%x00",
      "--follow",
      "--",
      gitPath,
    ]);
    return { entries: parseLogOutput(out) };
  } catch {
    return { entries: [] };
  }
}

/** Diff of one workspace-relative file introduced by a specific commit. */
export async function fileDiffAtCommit(
  cwd: string,
  relativePath: string,
  commitHash: string,
): Promise<{ supported: boolean; patch?: string }> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return { supported: false };
  const abs = path.resolve(cwd, relativePath);
  if (!isWithin(cwd, abs) || !isWithin(repositoryRoot, abs)) {
    return { supported: false };
  }
  const gitPath = toGitPath(path.relative(repositoryRoot, abs));
  const rev = commitHash?.trim() ?? "";
  if (!/^[0-9a-fA-F]{4,40}$/.test(rev)) return { supported: false };
  try {
    const patch = await git(repositoryRoot, [
      "show",
      "--no-color",
      "--no-ext-diff",
      "--unified=3",
      "--format=",
      rev,
      "--",
      gitPath,
    ]);
    if (!patch.trim()) return { supported: false };
    return { supported: true, patch };
  } catch {
    return { supported: false };
  }
}

/**
 * Restore one workspace-relative file to the content it had at a specific
 * commit. Updates both the index and the working tree (git checkout <rev> -- <path>).
 */
export async function restoreFileToCommit(
  cwd: string,
  relativePath: string,
  commitHash: string,
): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return fail("not_repo", "Not a git repository");
  const abs = path.resolve(cwd, relativePath);
  if (!isWithin(cwd, abs) || !isWithin(repositoryRoot, abs)) {
    return fail("invalid_args", `Path outside workspace: ${relativePath}`);
  }
  const gitPath = toGitPath(path.relative(repositoryRoot, abs));
  const rev = commitHash?.trim() ?? "";
  if (!/^[0-9a-fA-F]{4,40}$/.test(rev)) {
    return fail("invalid_args", "Invalid commit hash");
  }
  const result = await gitAllowFail(repositoryRoot, ["checkout", rev, "--", gitPath]);
  if (!result.ok) return fail(result.code, result.message);
  return { ok: true };
}

/**
 * Files changed by a specific commit (`git show --name-status`).
 */
export async function showCommitFiles(
  cwd: string,
  commitHash: string,
): Promise<{ files: { status: string; path: string }[] }> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return { files: [] };
  const rev = commitHash?.trim() ?? "";
  if (!/^[0-9a-fA-F]{4,40}$/.test(rev)) return { files: [] };
  try {
    const out = await git(repositoryRoot, [
      "show",
      "--name-status",
      "--format=",
      rev,
    ]);
    const files: { status: string; path: string }[] = [];
    for (const raw of out.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const parts = line.split("\t");
      const status = parts[0]?.trim() ?? "";
      if (!status) continue;
      // Renames: R<score>\told\tnew — keep the destination path.
      const path = parts[2] ?? parts[1] ?? "";
      if (path) files.push({ status: status.charAt(0) ?? status, path });
    }
    return { files };
  } catch {
    return { files: [] };
  }
}

/**
 * Reset the current branch to a commit: `--soft` keeps changes staged,
 * `--hard` discards working-tree changes.
 */
export async function resetToCommit(
  cwd: string,
  commitHash: string,
  mode: "soft" | "hard",
): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return fail("not_repo", "Not a git repository");
  const rev = commitHash?.trim() ?? "";
  if (!/^[0-9a-fA-F]{4,40}$/.test(rev)) {
    return fail("invalid_args", "Invalid commit hash");
  }
  if (mode !== "soft" && mode !== "hard") {
    return fail("invalid_args", "Reset mode must be soft or hard");
  }
  const flag = mode === "soft" ? "--soft" : "--hard";
  const result = await gitAllowFail(repositoryRoot, ["reset", flag, rev]);
  if (!result.ok) return fail(result.code, result.message);
  return { ok: true, message: `reset ${mode}` };
}

function assertPathsWithin(cwd: string, paths: string[], repositoryRoot: string): string[] | null {
  const gitPaths: string[] = [];
  for (const p of paths ?? []) {
    if (typeof p !== "string" || !p.trim()) continue;
    const abs = path.resolve(cwd, p);
    if (!isWithin(cwd, abs) || !isWithin(repositoryRoot, abs)) return null;
    gitPaths.push(toGitPath(path.relative(repositoryRoot, abs)));
  }
  return gitPaths;
}

/** Stage files (git add) — also stages deletions of tracked files. */
export async function stagePaths(
  cwd: string,
  paths: string[],
): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return fail("not_repo", "Not a git repository");
  const gitPaths = assertPathsWithin(cwd, paths, repositoryRoot);
  if (gitPaths === null || gitPaths.length === 0) return fail("invalid_args", "No valid paths to stage");
  const result = await gitAllowFail(repositoryRoot, ["add", "--", ...gitPaths]);
  if (!result.ok) return fail(result.code, result.message);
  return { ok: true };
}

/** Unstage files (git restore --staged). */
export async function unstagePaths(
  cwd: string,
  paths: string[],
): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return fail("not_repo", "Not a git repository");
  const gitPaths = assertPathsWithin(cwd, paths, repositoryRoot);
  if (gitPaths === null || gitPaths.length === 0) return fail("invalid_args", "No valid paths to unstage");
  const result = await gitAllowFail(repositoryRoot, ["restore", "--staged", "--", ...gitPaths]);
  if (!result.ok) return fail(result.code, result.message);
  return { ok: true };
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

  const rebase = await gitAllowFail(repositoryRoot, ["pull", "--rebase"], GIT_NETWORK_TIMEOUT_MS);
  if (rebase.ok) return { ok: true, message: rebase.stdout.trim() || undefined };
  if (rebase.code === "conflicts") return fail("conflicts", rebase.message);

  const plain = await gitAllowFail(repositoryRoot, ["pull"], GIT_NETWORK_TIMEOUT_MS);
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

  const push = await gitAllowFail(repositoryRoot, ["push"], GIT_NETWORK_TIMEOUT_MS);
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
  const upstream = await gitAllowFail(
    repositoryRoot,
    ["push", "-u", origin.name, branch],
    GIT_NETWORK_TIMEOUT_MS,
  );
  if (upstream.ok) return { ok: true, message: upstream.stdout.trim() || undefined };
  return fail(upstream.code, upstream.message || push.message);
}

async function readIndexStage(
  repositoryRoot: string,
  stage: 2 | 3,
  repoRelative: string,
): Promise<string> {
  const result = await gitAllowFail(repositoryRoot, ["show", `:${stage}:${repoRelative}`]);
  if (!result.ok) return "";
  return result.stdout;
}

async function conflictSideLabels(
  repositoryRoot: string,
): Promise<{ ours: string; theirs: string }> {
  let ours = "HEAD";
  try {
    const branch = (await git(repositoryRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    if (branch && branch !== "HEAD") ours = branch;
  } catch {
    /* keep HEAD */
  }

  let theirs = "theirs";
  for (const headRef of ["MERGE_HEAD", "REBASE_HEAD"] as const) {
    const verify = await gitAllowFail(repositoryRoot, ["rev-parse", "-q", "--verify", headRef]);
    if (!verify.ok) continue;
    const nameRev = await gitAllowFail(repositoryRoot, ["name-rev", "--name-only", headRef]);
    if (nameRev.ok && nameRev.stdout.trim()) {
      theirs = nameRev.stdout.trim().replace(/^remotes\//, "");
      break;
    }
  }

  return { ours, theirs };
}

export async function getConflictContent(
  cwd: string,
  relativePath: string,
): Promise<GitConflictContentResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return { supported: false, reason: "not_repo" };

  const resolvedFilePath = path.resolve(cwd, relativePath);
  if (!isWithin(cwd, resolvedFilePath) || !isWithin(repositoryRoot, resolvedFilePath)) {
    return { supported: false, reason: "not_found" };
  }

  const repoRelative = toGitPath(path.relative(repositoryRoot, resolvedFilePath));

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolvedFilePath);
  } catch {
    return { supported: false, reason: "not_found" };
  }
  if (!stat.isFile()) return { supported: false, reason: "not_found" };
  if (stat.size > TEXT_PREVIEW_MAX_BYTES) return { supported: false, reason: "too_large" };

  const currentBuffer = fs.readFileSync(resolvedFilePath);
  if (hasNullByte(currentBuffer)) return { supported: false, reason: "binary" };

  const working = currentBuffer.toString("utf8");
  const ours = await readIndexStage(repositoryRoot, 2, repoRelative);
  const theirs = await readIndexStage(repositoryRoot, 3, repoRelative);
  const oursReject = stageTextRejectReason(ours);
  if (oursReject) return { supported: false, reason: oursReject };
  const theirsReject = stageTextRejectReason(theirs);
  if (theirsReject) return { supported: false, reason: theirsReject };
  const labels = await conflictSideLabels(repositoryRoot);

  return { supported: true, working, ours, theirs, labels };
}

export async function resolveConflictPath(
  cwd: string,
  relativePath: string,
  content: string,
): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return fail("not_repo", "Not a git repository");

  const resolvedFilePath = path.resolve(cwd, relativePath);
  if (!isWithin(cwd, resolvedFilePath) || !isWithin(repositoryRoot, resolvedFilePath)) {
    return fail("invalid_args", `Path outside workspace: ${relativePath}`);
  }

  const repoRelative = toGitPath(path.relative(repositoryRoot, resolvedFilePath));
  fs.writeFileSync(resolvedFilePath, content, "utf8");

  const add = await gitAllowFail(repositoryRoot, ["add", "--", repoRelative]);
  if (!add.ok) return fail(add.code, add.message);
  return { ok: true };
}

export async function checkoutConflictSide(
  cwd: string,
  relativePath: string,
  side: "ours" | "theirs",
): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return fail("not_repo", "Not a git repository");

  const resolvedFilePath = path.resolve(cwd, relativePath);
  if (!isWithin(cwd, resolvedFilePath) || !isWithin(repositoryRoot, resolvedFilePath)) {
    return fail("invalid_args", `Path outside workspace: ${relativePath}`);
  }

  const repoRelative = toGitPath(path.relative(repositoryRoot, resolvedFilePath));
  const sideFlag = side === "ours" ? "--ours" : "--theirs";

  const checkout = await gitAllowFail(repositoryRoot, ["checkout", sideFlag, "--", repoRelative]);
  if (!checkout.ok) return fail(checkout.code, checkout.message);

  const add = await gitAllowFail(repositoryRoot, ["add", "--", repoRelative]);
  if (!add.ok) return fail(add.code, add.message);
  return { ok: true };
}

export async function abortMerge(cwd: string): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return fail("not_repo", "Not a git repository");

  const gitDir = (await git(repositoryRoot, ["rev-parse", "--git-dir"])).trim();
  const absGitDir = path.isAbsolute(gitDir) ? gitDir : path.join(repositoryRoot, gitDir);
  const rebasing =
    fs.existsSync(path.join(absGitDir, "rebase-merge")) ||
    fs.existsSync(path.join(absGitDir, "rebase-apply"));

  const result = await gitAllowFail(
    repositoryRoot,
    rebasing ? ["rebase", "--abort"] : ["merge", "--abort"],
  );
  if (!result.ok) return fail(result.code, result.message);
  return { ok: true };
}

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;
const GIT_STATUS_MAX_BUFFER = 8 * 1024 * 1024;
const TEXT_PREVIEW_MAX_BYTES = 1.5 * 1024 * 1024;

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

export type GitOpResult = { ok: true; message?: string } | { ok: false; message: string };

type PorcelainEntry = {
  path: string;
  originalPath?: string;
  indexStatus: string;
  worktreeStatus: string;
};

async function git(
  cwd: string,
  args: string[],
  maxBuffer = GIT_STATUS_MAX_BUFFER,
): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout;
}

async function gitAllowFail(
  cwd: string,
  args: string[],
): Promise<{ ok: true; stdout: string } | { ok: false; message: string }> {
  try {
    const stdout = await git(cwd, args);
    return { ok: true, stdout };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const message = (e.stderr || e.message || String(err)).trim() || "git command failed";
    return { ok: false, message };
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
  const rel = path.relative(path.resolve(parent), path.resolve(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function toGitPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

async function findRepositoryRoot(cwd: string): Promise<string | null> {
  try {
    return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim() || null;
  } catch {
    return null;
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
  const repositoryRoot = await findRepositoryRoot(cwd);
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
    const trackedPatch = await createTrackedFilePatch(
      repositoryRoot,
      repoRelative,
      entry.originalPath,
    );
    if (trackedPatch === null) {
      if (status !== "added") return { supported: false };
      patch = createAddedFilePatch(repoRelative, newContent);
      oldContent = "";
    } else {
      patch = trackedPatch;
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
  if (!repositoryRoot) return { ok: false, message: "Not a git repository" };
  const name = branch.trim();
  if (!name) return { ok: false, message: "Branch name required" };
  const result = await gitAllowFail(repositoryRoot, ["checkout", name]);
  if (!result.ok) return result;
  return { ok: true };
}

export async function createBranch(cwd: string, branch: string): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return { ok: false, message: "Not a git repository" };
  const name = branch.trim();
  if (!name) return { ok: false, message: "Branch name required" };
  const result = await gitAllowFail(repositoryRoot, ["checkout", "-b", name]);
  if (!result.ok) return result;
  return { ok: true };
}

export async function mergeBranch(cwd: string, branch: string): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return { ok: false, message: "Not a git repository" };
  const name = branch.trim();
  if (!name) return { ok: false, message: "Branch name required" };
  const result = await gitAllowFail(repositoryRoot, ["merge", name]);
  if (!result.ok) return result;
  return { ok: true, message: result.stdout.trim() || undefined };
}

export async function commitPaths(
  cwd: string,
  message: string,
  relativePaths: string[],
): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return { ok: false, message: "Not a git repository" };
  const msg = message.trim();
  if (!msg) return { ok: false, message: "Commit message required" };
  if (!relativePaths.length) return { ok: false, message: "No files selected" };

  const repoPaths: string[] = [];
  for (const rel of relativePaths) {
    const abs = path.resolve(cwd, rel);
    if (!isWithin(cwd, abs) || !isWithin(repositoryRoot, abs)) {
      return { ok: false, message: `Path outside workspace: ${rel}` };
    }
    repoPaths.push(toGitPath(path.relative(repositoryRoot, abs)));
  }

  const add = await gitAllowFail(repositoryRoot, ["add", "--", ...repoPaths]);
  if (!add.ok) return add;
  const commit = await gitAllowFail(repositoryRoot, ["commit", "-m", msg]);
  if (!commit.ok) return commit;
  return { ok: true };
}

export async function pullRepo(cwd: string): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return { ok: false, message: "Not a git repository" };
  const rebase = await gitAllowFail(repositoryRoot, ["pull", "--rebase"]);
  if (rebase.ok) return { ok: true, message: rebase.stdout.trim() || undefined };
  const plain = await gitAllowFail(repositoryRoot, ["pull"]);
  if (plain.ok) return { ok: true, message: plain.stdout.trim() || undefined };
  return { ok: false, message: rebase.message };
}

export async function pushRepo(cwd: string): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return { ok: false, message: "Not a git repository" };
  const push = await gitAllowFail(repositoryRoot, ["push"]);
  if (push.ok) return { ok: true, message: push.stdout.trim() || undefined };

  let branch = "";
  try {
    branch = (await git(repositoryRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  } catch {
    return push;
  }
  if (!branch || branch === "HEAD") return push;

  const upstream = await gitAllowFail(repositoryRoot, ["push", "-u", "origin", branch]);
  if (upstream.ok) return { ok: true, message: upstream.stdout.trim() || undefined };
  return { ok: false, message: `${push.message}\n${upstream.message}` };
}

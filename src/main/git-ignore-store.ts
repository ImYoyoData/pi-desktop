import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { matchesGitIgnorePatterns } from "../shared/git-ignore";

/**
 * Workspace file filter backed by real `.gitignore` rules.
 * Rules added here live inside a marker block so removing the filter deletes
 * only our rules and never the user's own .gitignore entries.
 */

const BLOCK_START = "# >>> pi-desktop filter >>>";
const BLOCK_END = "# <<< pi-desktop filter <<<";

function gitignorePath(workspace: string): string {
  return path.join(path.resolve(workspace || "."), ".gitignore");
}

/** Normalize a relative path for matching (forward slashes, no leading slash). */
function normalizePattern(input: string): string {
  return (input ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Rule text stored in .gitignore for a path: files stay bare, folders get a
 * trailing slash (`dist` → `dist/`) per gitignore semantics.
 */
function toRule(relativePath: string, isDir: boolean): string {
  const norm = normalizePattern(relativePath).replace(/\/+$/, "");
  return norm ? (isDir ? `${norm}/` : norm) : "";
}

function readFile(filePath: string): string | null {
  try {
    return existsSync(filePath) ? readFileSync(filePath, "utf8") : null;
  } catch {
    return null;
  }
}

/**
 * Parse the managed rules out of a .gitignore body. Returns { rules, rest }
 * where `rest` keeps every user line byte-for-byte (line endings included).
 */
function splitManagedBlock(body: string): { rules: string[]; rest: string } {
  const parts = body.split(/(\r?\n)/);
  let inBlock = false;
  const rules: string[] = [];
  const kept: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const raw = parts[i] ?? "";
    const ending = parts[i + 1] ?? "";
    const line = raw.trim();
    if (line === BLOCK_START) {
      // 托管块前的那一个换行由写入方补上，删除时一并回收，正文可原样还原。
      const last = kept[kept.length - 1];
      if (last !== undefined) {
        if (last === "\n" || last === "\r\n") kept.pop();
        else if (last.endsWith("\r\n")) kept[kept.length - 1] = last.slice(0, -2);
        else if (last.endsWith("\n")) kept[kept.length - 1] = last.slice(0, -1);
      }
      inBlock = true;
      continue;
    }
    if (line === BLOCK_END) {
      inBlock = false;
      continue;
    }
    if (inBlock) {
      if (line && !line.startsWith("#")) rules.push(line);
      continue;
    }
    kept.push(raw + ending);
  }
  return { rules, rest: kept.join("") };
}

function writeGitignore(filePath: string, rest: string, rules: string[]): void {
  if (rules.length === 0) {
    // 只删托管块，其余内容原样写回（不 trim、不折叠空行、不删文件）。
    writeFileSync(filePath, rest, "utf8");
    return;
  }
  const block = [BLOCK_START, ...rules, BLOCK_END].join("\n");
  const prefix = rest ? `${rest}\n` : "";
  writeFileSync(filePath, `${prefix}${block}\n`, "utf8");
}

export function listGitIgnored(workspace: string): string[] {
  const body = readFile(gitignorePath(workspace));
  if (body === null) return [];
  return splitManagedBlock(body).rules;
}

/** Add relative paths/folders to the workspace .gitignore (managed block). */
export function addGitIgnored(
  workspace: string,
  paths: Array<{ relativePath: string; isDir: boolean } | string>,
): string[] {
  const filePath = gitignorePath(workspace);
  const body = readFile(filePath) ?? "";
  const { rules, rest } = splitManagedBlock(body);
  const current = new Set(rules);
  for (const p of paths) {
    const isDir = typeof p === "object" ? p.isDir : false;
    const raw = typeof p === "object" ? p.relativePath : p;
    const rule = toRule(raw, isDir);
    if (rule) current.add(rule);
  }
  const next = [...current].sort();
  writeGitignore(filePath, rest, next);
  return next;
}

/** Remove a managed rule from the workspace .gitignore. */
export function removeGitIgnored(workspace: string, relativePath: string): string[] {
  const filePath = gitignorePath(workspace);
  const body = readFile(filePath);
  if (body === null) return [];
  const { rules, rest } = splitManagedBlock(body);
  const norm = normalizePattern(relativePath).replace(/\/+$/, "");
  const next = rules.filter((r) => {
    const rNorm = normalizePattern(r).replace(/\/+$/, "");
    return rNorm !== norm;
  });
  if (next.length === rules.length) return rules;
  writeGitignore(filePath, rest, next);
  return next;
}

/**
 * True when a workspace-relative path matches the managed filter rules.
 */
export function isGitIgnoredPath(workspace: string, relativePath: string): boolean {
  return matchesGitIgnorePatterns(relativePath, listGitIgnored(workspace));
}

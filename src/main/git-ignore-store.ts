import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { agentDir } from "./agent-dir";

/**
 * Per-workspace git file filter (UI-level ignore list). Stored in
 * ~/.pi/agent/git-ignore.json so filtering never touches the repo.
 */

function storePath(): string {
  return path.join(agentDir(), "git-ignore.json");
}

function workspaceKey(workspace: string): string {
  return path.resolve(workspace || "").replace(/\\/g, "/").toLowerCase();
}

function readStore(): Record<string, string[]> {
  try {
    const parsed = JSON.parse(readFileSync(storePath(), "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string[]>;
    }
  } catch {
    // ignore
  }
  return {};
}

function writeStore(data: Record<string, string[]>): void {
  writeFileSync(storePath(), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function normalizePattern(input: string): string {
  return (input ?? "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function listGitIgnored(workspace: string): string[] {
  return readStore()[workspaceKey(workspace)] ?? [];
}

/** Add relative paths/folders to the workspace ignore list. */
export function addGitIgnored(workspace: string, paths: string[]): string[] {
  const key = workspaceKey(workspace);
  const data = readStore();
  const current = new Set(data[key] ?? []);
  for (const p of paths) {
    const normalized = normalizePattern(p);
    if (normalized) current.add(normalized);
  }
  const next = [...current].sort();
  data[key] = next;
  writeStore(data);
  return next;
}

export function removeGitIgnored(workspace: string, path: string): string[] {
  const key = workspaceKey(workspace);
  const data = readStore();
  const current = (data[key] ?? []).filter((p) => p !== normalizePattern(path));
  if (current.length) data[key] = current;
  else delete data[key];
  writeStore(data);
  return current;
}

import { matchesGitIgnorePatterns } from "../shared/git-ignore";

/**
 * True when a workspace-relative path matches the ignore list (exact file or
 * a folder prefix — `dist` also matches `dist/x/y`).
 */
export function isGitIgnoredPath(workspace: string, relativePath: string): boolean {
  return matchesGitIgnorePatterns(relativePath, listGitIgnored(workspace));
}

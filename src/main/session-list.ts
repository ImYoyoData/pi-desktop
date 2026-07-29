import { getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";
import type { SessionSummary } from "../shared/protocol";

export function resolveAgentDir(): string {
  return getAgentDir();
}

/** Matches Pi SDK default session directory encoding under ~/.pi/agent/sessions/. */
export function encodeCwdSessionDir(cwd: string, agentDir?: string): string {
  const resolvedCwd = path.resolve(cwd);
  const resolvedAgentDir = path.resolve(agentDir ?? resolveAgentDir());
  const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return path.join(resolvedAgentDir, "sessions", safePath);
}

/** Case-fold on Windows so Desktop recent and CLI cwd keys merge cleanly. */
export function normalizeWorkspacePath(input: string): string {
  const resolved = path.resolve(input.trim());
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function workspacePathsEqual(a: string, b: string): boolean {
  return normalizeWorkspacePath(a) === normalizeWorkspacePath(b);
}

function sessionInfoToSummary(info: {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  modified: Date;
  firstMessage: string;
}): SessionSummary {
  return {
    id: info.id,
    filePath: info.path,
    cwd: info.cwd,
    name: info.name,
    modified: info.modified.toISOString(),
    firstMessage: info.firstMessage,
    status: "idle",
  };
}

export async function listSessionsForCwd(cwd: string): Promise<SessionSummary[]> {
  const resolvedCwd = path.resolve(cwd);
  const infos = await SessionManager.list(resolvedCwd);
  return infos
    .filter((info) => {
      const sessionCwd = info.cwd ? path.resolve(info.cwd) : resolvedCwd;
      return workspacePathsEqual(sessionCwd, resolvedCwd);
    })
    .map(sessionInfoToSummary)
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

/**
 * Workspaces that already have Pi CLI / Desktop sessions under ~/.pi/agent/sessions.
 * Sorted by most recently modified session. Missing folders on disk are skipped.
 */
export async function listPiCliWorkspaces(): Promise<string[]> {
  const infos = await SessionManager.listAll();
  const latestByCwd = new Map<string, { display: string; modified: number }>();

  for (const info of infos) {
    const raw = typeof info.cwd === "string" ? info.cwd.trim() : "";
    if (!raw) continue;
    const display = path.resolve(raw);
    const key = normalizeWorkspacePath(display);
    const modified = info.modified instanceof Date ? info.modified.getTime() : 0;
    const prev = latestByCwd.get(key);
    if (!prev || modified > prev.modified) {
      latestByCwd.set(key, { display, modified });
    }
  }

  return [...latestByCwd.values()]
    .filter((row) => {
      try {
        return fs.existsSync(row.display) && fs.statSync(row.display).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.modified - a.modified)
    .map((row) => row.display);
}

/**
 * Desktop recent order first, then append Pi CLI workspaces not already listed.
 * `dismissed` hides Pi-discovered roots the user removed from the sidebar.
 */
export async function mergeRecentWithPiCliWorkspaces(
  desktopRecent: string[],
  dismissed: string[] = [],
): Promise<string[]> {
  const fromPi = await listPiCliWorkspaces();
  const merged: string[] = [];
  const seen = new Set<string>();
  const dismissedKeys = new Set(dismissed.map((p) => normalizeWorkspacePath(p)));

  const push = (raw: string, allowDismissed: boolean): void => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const key = normalizeWorkspacePath(trimmed);
    if (seen.has(key)) return;
    if (!allowDismissed && dismissedKeys.has(key)) return;
    seen.add(key);
    merged.push(path.resolve(trimmed));
  };

  // Explicit Desktop recent always wins (even if previously dismissed via Pi-only remove).
  for (const entry of desktopRecent) push(entry, true);
  for (const entry of fromPi) push(entry, false);
  return merged;
}

import { agentDir } from "./agent-dir";
import fs from "node:fs";
import path from "node:path";
import type { SessionSummary } from "../shared/protocol";

export function resolveAgentDir(): string {
  return agentDir();
}

/** Matches Pi SDK default session directory encoding under ~/.pi/agent/sessions/. */
export function encodeCwdSessionDir(cwd: string, agentDir?: string): string {
  const resolvedCwd = path.resolve(cwd);
  const resolvedAgentDir = path.resolve(agentDir ?? resolveAgentDir());
  const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return path.join(resolvedAgentDir, "sessions", safePath);
}

/** Case-fold on Windows/macOS so Desktop recent and CLI cwd keys merge cleanly. */
export function normalizeWorkspacePath(input: string): string {
  const resolved = path.resolve(input.trim());
  // macOS APFS is case-insensitive by default, like Windows.
  return process.platform === "win32" || process.platform === "darwin"
    ? resolved.toLowerCase()
    : resolved;
}

export function workspacePathsEqual(a: string, b: string): boolean {
  return normalizeWorkspacePath(a) === normalizeWorkspacePath(b);
}

/**
 * Caches for session listings.
 *
 * Pi's SessionManager.list reads the ENTIRE content of every session jsonl to
 * build name / firstMessage / modified. It used to run on every session open,
 * every sidebar refresh and every workspace switch (via listPiCliWorkspaces),
 * which made switching sessions/workspaces visibly laggy on workspaces with
 * many (or large) session files. The signature below is computed from file
 * sizes + mtimes only (no content reads), so cached results stay fresh cheaply.
 */
const sessionListCache = new Map<string, { signature: string; sessions: SessionSummary[] }>();
let piWorkspacesCache: { agentDir: string; signature: string; workspaces: string[] } | null = null;

/** Signature of the .jsonl files in one session dir (sizes + mtimes, no content). */
async function dirJsonlSignature(dir: string): Promise<string | null> {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const rows: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    try {
      const st = await fs.promises.stat(path.join(dir, entry.name));
      rows.push(`${entry.name}:${st.size}:${Math.floor(st.mtimeMs)}`);
    } catch {
      // skip unreadable files
    }
  }
  rows.sort();
  return rows.join("|");
}

/** Signature across every workspace's session dir (dir name + its file signature). */
async function sessionsTreeSignature(sessionsDir: string): Promise<string | null> {
  let entries;
  try {
    entries = await fs.promises.readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const rows: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sub = path.join(sessionsDir, entry.name);
    const files = await dirJsonlSignature(sub);
    rows.push(`${entry.name}:${files ?? "-"}`);
  }
  rows.sort();
  return rows.join("|");
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

/** Drop listing caches (after deleting a workspace's Pi sessions). */
export function invalidateSessionListCaches(cwd?: string): void {
  if (cwd) {
    sessionListCache.delete(encodeCwdSessionDir(path.resolve(cwd)));
  } else {
    sessionListCache.clear();
  }
  piWorkspacesCache = null;
}

/**
 * Delete Pi's session store for a workspace under `~/.pi/agent/sessions/...`.
 * Never touches the project directory itself — only the encoded session folder.
 */
export async function purgeWorkspaceSessionDir(cwd: string): Promise<void> {
  const resolvedCwd = path.resolve(cwd);
  const sessionDir = encodeCwdSessionDir(resolvedCwd);
  const agentSessionsRoot = path.resolve(resolveAgentDir(), "sessions");
  const resolvedSessionDir = path.resolve(sessionDir);
  const rel = path.relative(agentSessionsRoot, resolvedSessionDir);
  // Safety: only delete a direct child of the agent sessions root.
  if (
    !rel ||
    rel.startsWith("..") ||
    path.isAbsolute(rel) ||
    rel.includes("..") ||
    rel.split(path.sep).length !== 1
  ) {
    throw new Error("refuse to purge session dir outside agent sessions root");
  }
  invalidateSessionListCaches(resolvedCwd);
  try {
    await fs.promises.rm(resolvedSessionDir, { recursive: true, force: true });
  } catch {
    // already gone
  }
}

export async function listSessionsForCwd(cwd: string): Promise<SessionSummary[]> {
  const resolvedCwd = path.resolve(cwd);
  const sessionDir = encodeCwdSessionDir(resolvedCwd);
  const signature = await dirJsonlSignature(sessionDir);
  if (signature === null) return [];
  const key = sessionDir; // includes agent dir, so env changes never serve stale rows
  const hit = sessionListCache.get(key);
  if (hit && hit.signature === signature) return hit.sessions;

  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const infos = await SessionManager.list(resolvedCwd);
  const sessions = infos
    .filter((info) => {
      const sessionCwd = info.cwd ? path.resolve(info.cwd) : resolvedCwd;
      return workspacePathsEqual(sessionCwd, resolvedCwd);
    })
    .map(sessionInfoToSummary)
    .sort((a, b) => b.modified.localeCompare(a.modified));

  sessionListCache.set(key, { signature, sessions });
  if (sessionListCache.size > 64) {
    const oldest = sessionListCache.keys().next().value;
    if (typeof oldest === "string") sessionListCache.delete(oldest);
  }
  return sessions;
}

/**
 * Workspaces that already have Pi CLI / Desktop sessions under ~/.pi/agent/sessions.
 * Sorted by most recently modified session. Missing folders on disk are skipped.
 */
export async function listPiCliWorkspaces(): Promise<string[]> {
  const agentDir = resolveAgentDir();
  const sessionsDir = path.join(agentDir, "sessions");
  const signature = await sessionsTreeSignature(sessionsDir);
  if (
    piWorkspacesCache &&
    piWorkspacesCache.agentDir === agentDir &&
    signature != null &&
    piWorkspacesCache.signature === signature
  ) {
    return piWorkspacesCache.workspaces;
  }

  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
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

  const result = [...latestByCwd.values()]
    .filter((row) => {
      try {
        return fs.existsSync(row.display) && fs.statSync(row.display).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.modified - a.modified)
    .map((row) => row.display);

  if (signature != null) {
    piWorkspacesCache = { agentDir, signature, workspaces: result };
  }
  return result;
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

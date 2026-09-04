import { agentDir } from "./agent-dir";
import fs from "node:fs";
import path from "node:path";
import type { SessionSummary } from "../shared/protocol";
import { listSessionSummariesOffMain } from "./session-history-offload";
import type { DiskSessionRow } from "./session-history-worker";

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
const sessionListCache = new Map<
  string,
  { signature: string; sessions: SessionSummary[] }
>();
let piWorkspacesCache: {
  agentDir: string;
  signature: string;
  workspaces: string[];
} | null = null;

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
async function sessionsTreeSignature(
  sessionsDir: string,
): Promise<string | null> {
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

function diskRowToSummary(row: {
  id: string;
  filePath: string;
  cwd: string;
  name?: string;
  modified: string;
  firstMessage: string;
}): SessionSummary {
  return {
    id: row.id,
    filePath: row.filePath,
    cwd: row.cwd,
    name: row.name,
    modified: row.modified,
    firstMessage: row.firstMessage,
    status: "idle",
  };
}

/** Local fallback when the worker script is not built (tests run from src/). */
function readSessionSummaryFallback(filePath: string): DiskSessionRow | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    let header: Record<string, unknown> | null = null;
    let name: string | undefined;
    let firstMessage = "";
    let lastActivityTime: number | undefined;
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!header) {
        if (entry.type !== "session" || typeof entry.id !== "string")
          return null;
        header = entry;
        continue;
      }
      if (entry.type === "session_info") {
        const rawName = (entry as { name?: unknown }).name;
        name =
          typeof rawName === "string" && rawName.trim()
            ? rawName.trim()
            : undefined;
        continue;
      }
      if (entry.type !== "message") continue;
      const message = (entry as { message?: unknown }).message;
      if (!message || typeof message !== "object") continue;
      const msg = message as {
        role?: unknown;
        content?: unknown;
        timestamp?: unknown;
      };
      if (msg.role !== "user" && msg.role !== "assistant") continue;
      const activityTime =
        typeof msg.timestamp === "number"
          ? msg.timestamp
          : new Date(String(entry.timestamp ?? "")).getTime();
      if (typeof activityTime === "number" && !Number.isNaN(activityTime)) {
        lastActivityTime = Math.max(lastActivityTime ?? 0, activityTime);
      }
      if (firstMessage || msg.role !== "user") continue;
      const content = msg.content;
      if (typeof content === "string") {
        firstMessage = content;
      } else if (Array.isArray(content)) {
        firstMessage = content
          .filter(
            (block): block is { type: string; text: string } =>
              Boolean(block) &&
              typeof block === "object" &&
              (block as { type?: unknown }).type === "text" &&
              typeof (block as { text?: unknown }).text === "string",
          )
          .map((block) => block.text)
          .join(" ");
      }
    }
    if (!header) return null;
    const headerTime = new Date(String(header.timestamp ?? "")).getTime();
    const modified =
      typeof lastActivityTime === "number" && lastActivityTime > 0
        ? new Date(lastActivityTime)
        : !Number.isNaN(headerTime)
          ? new Date(headerTime)
          : fs.statSync(filePath).mtime;
    return {
      id: String(header.id),
      filePath,
      cwd: typeof header.cwd === "string" ? header.cwd : "",
      name,
      modified: modified.toISOString(),
      firstMessage: firstMessage || "(no messages)",
    };
  } catch {
    return null;
  }
}

/** Fallback for listSessionsForCwd / listPiCliWorkspaces when no worker build. */
async function listSessionSummariesFallback(
  dir: string | null,
  sessionsRoot: string | null,
): Promise<DiskSessionRow[]> {
  const dirs: string[] = [];
  if (dir) {
    dirs.push(dir);
  } else if (sessionsRoot) {
    try {
      for (const entry of await fs.promises.readdir(sessionsRoot, {
        withFileTypes: true,
      })) {
        if (entry.isDirectory()) dirs.push(path.join(sessionsRoot, entry.name));
      }
    } catch {
      return [];
    }
  }
  const rows: DiskSessionRow[] = [];
  for (const sessionDir of dirs) {
    let files: string[];
    try {
      files = await fs.promises.readdir(sessionDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const row = readSessionSummaryFallback(path.join(sessionDir, file));
      if (row) rows.push(row);
    }
  }
  rows.sort((a, b) => b.modified.localeCompare(a.modified));
  return rows;
}

async function listSessionSummariesSafe(job: {
  dir?: string;
  allUnder?: string;
}): Promise<DiskSessionRow[]> {
  try {
    return await listSessionSummariesOffMain(job);
  } catch {
    return listSessionSummariesFallback(job.dir ?? null, job.allUnder ?? null);
  }
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

export async function listSessionsForCwd(
  cwd: string,
): Promise<SessionSummary[]> {
  const resolvedCwd = path.resolve(cwd);
  const sessionDir = encodeCwdSessionDir(resolvedCwd);
  const signature = await dirJsonlSignature(sessionDir);
  if (signature === null) return [];
  const key = sessionDir; // includes agent dir, so env changes never serve stale rows
  const hit = sessionListCache.get(key);
  if (hit && hit.signature === signature) return hit.sessions;

  const rows = await listSessionSummariesSafe({ dir: sessionDir });
  const sessions = rows
    .filter((row) => {
      const sessionCwd = row.cwd ? path.resolve(row.cwd) : resolvedCwd;
      return workspacePathsEqual(sessionCwd, resolvedCwd);
    })
    .map(diskRowToSummary)
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
  if (process.env.PI_DESKTOP_NO_FULL_RECENT === "1") return [];
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

  const rows = await listSessionSummariesSafe({ allUnder: sessionsDir });
  const latestByCwd = new Map<string, { display: string; modified: number }>();

  for (const row of rows) {
    const raw = typeof row.cwd === "string" ? row.cwd.trim() : "";
    if (!raw) continue;
    const display = path.resolve(raw);
    const key = normalizeWorkspacePath(display);
    const modified = Date.parse(row.modified) || 0;
    const prev = latestByCwd.get(key);
    if (!prev || modified > prev.modified) {
      latestByCwd.set(key, { display, modified });
    }
  }

  const result = [...latestByCwd.values()]
    .filter((row) => {
      try {
        return (
          fs.existsSync(row.display) && fs.statSync(row.display).isDirectory()
        );
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
  const dismissedKeys = new Set(
    dismissed.map((p) => normalizeWorkspacePath(p)),
  );

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

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const CHECKPOINT_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const CHECKPOINT_MAX_FILES = 3000;

/** Same deny-list as fs-watch-host (plus optional local cache dir). */
const IGNORE_DIR_SEGMENTS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "out",
  ".next",
  "coverage",
  "__pycache__",
  ".turbo",
  ".cache",
  ".pi-desktop-checkpoints",
]);

export type CheckpointStatus = "capturing" | "ready" | "reverted" | "empty";

export type CheckpointSummary = {
  sessionId: string;
  userMessageId: string;
  status: CheckpointStatus;
  fileCount: number;
  skippedCount: number;
};

type TurnCheckpoint = {
  id: string;
  sessionId: string;
  userMessageId: string;
  workspaceRoot: string;
  status: CheckpointStatus;
  /** Relative posix path → content at begin (only files that existed). */
  baseline: Map<string, string>;
  /** Paths touched during the turn (relative posix). */
  touched: Set<string>;
  skippedAtBegin: number;
  createdAt: number;
};

const byKey = new Map<string, TurnCheckpoint>();
/** sessionId → active capturing checkpoint key */
const activeBySession = new Map<string, string>();

function keyOf(sessionId: string, userMessageId: string): string {
  return `${sessionId}::${userMessageId}`;
}

function toPosix(rel: string): string {
  return rel.split(path.sep).join("/").replace(/^\/+/, "");
}

function rootsEqual(a: string, b: string): boolean {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  // Windows and macOS (default APFS) are case-insensitive — fold both.
  return process.platform === "win32" || process.platform === "darwin"
    ? na.toLowerCase() === nb.toLowerCase()
    : na === nb;
}

export function shouldIgnoreCheckpointPath(relPosix: string): boolean {
  const parts = relPosix.split("/").filter(Boolean);
  return parts.some((p) => IGNORE_DIR_SEGMENTS.has(p));
}

function hasNullByte(buf: Buffer): boolean {
  return buf.includes(0);
}

/** Snapshot text files under root for baseline (ignore + size caps). */
export function snapshotWorkspaceBaseline(
  root: string,
  opts?: { maxFiles?: number; maxBytes?: number },
): { baseline: Map<string, string>; skipped: number } {
  const maxFiles = opts?.maxFiles ?? CHECKPOINT_MAX_FILES;
  const maxBytes = opts?.maxBytes ?? CHECKPOINT_MAX_FILE_BYTES;
  const baseline = new Map<string, string>();
  let skipped = 0;
  const rootResolved = path.resolve(root);

  const walk = (absDir: string, relPosix: string): void => {
    if (baseline.size >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (baseline.size >= maxFiles) return;
      const name = ent.name;
      const childRel = relPosix ? `${relPosix}/${name}` : name;
      if (shouldIgnoreCheckpointPath(childRel)) continue;
      const childAbs = path.join(absDir, name);
      let isDir = ent.isDirectory();
      let isFile = ent.isFile();
      if (ent.isSymbolicLink()) {
        try {
          const st = fs.statSync(childAbs);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue;
        }
      }
      if (isDir) {
        walk(childAbs, childRel);
        continue;
      }
      if (!isFile) continue;
      try {
        const st = fs.statSync(childAbs);
        if (st.size > maxBytes) {
          skipped += 1;
          continue;
        }
        const buf = fs.readFileSync(childAbs);
        if (hasNullByte(buf)) {
          skipped += 1;
          continue;
        }
        baseline.set(childRel, buf.toString("utf8"));
      } catch {
        skipped += 1;
      }
    }
  };

  walk(rootResolved, "");
  return { baseline, skipped };
}

export function beginCheckpoint(
  sessionId: string,
  userMessageId: string,
  workspaceRoot: string | null,
): CheckpointSummary {
  if (!workspaceRoot) {
    return {
      sessionId,
      userMessageId,
      status: "empty",
      fileCount: 0,
      skippedCount: 0,
    };
  }

  const prevKey = activeBySession.get(sessionId);
  if (prevKey) {
    const prev = byKey.get(prevKey);
    if (prev && prev.status === "capturing") {
      finishCheckpoint(prev.sessionId, prev.userMessageId);
    }
  }

  const root = path.resolve(workspaceRoot);
  const { baseline, skipped } = snapshotWorkspaceBaseline(root);
  const cp: TurnCheckpoint = {
    id: randomUUID(),
    sessionId,
    userMessageId,
    workspaceRoot: root,
    status: "capturing",
    baseline,
    touched: new Set(),
    skippedAtBegin: skipped,
    createdAt: Date.now(),
  };
  const key = keyOf(sessionId, userMessageId);
  byKey.set(key, cp);
  activeBySession.set(sessionId, key);
  return toSummary(cp);
}

export function noteCheckpointFsChange(
  workspaceRoot: string,
  relativePath: string,
  _kind: "add" | "change" | "unlink",
): void {
  const rel = toPosix(relativePath);
  if (!rel || shouldIgnoreCheckpointPath(rel)) return;
  const root = path.resolve(workspaceRoot);
  for (const cp of byKey.values()) {
    if (cp.status !== "capturing") continue;
    if (!rootsEqual(cp.workspaceRoot, root)) continue;
    cp.touched.add(rel);
  }
}

export function finishCheckpoint(sessionId: string, userMessageId: string): CheckpointSummary {
  const key = keyOf(sessionId, userMessageId);
  const cp = byKey.get(key);
  if (!cp) {
    return { sessionId, userMessageId, status: "empty", fileCount: 0, skippedCount: 0 };
  }
  if (cp.status === "capturing") {
    // Don't rely solely on fs.watch — reconcile against the begin baseline.
    reconcileTouchedFromDisk(cp);
    cp.status = cp.touched.size > 0 ? "ready" : "empty";
  }
  if (activeBySession.get(sessionId) === key) {
    activeBySession.delete(sessionId);
  }
  return toSummary(cp);
}

/**
 * Mark paths that differ from the begin baseline (modified / deleted / created).
 * Complements fs.watch, which can miss events on some platforms / editors.
 */
function reconcileTouchedFromDisk(cp: TurnCheckpoint): void {
  const maxBytes = CHECKPOINT_MAX_FILE_BYTES;
  const maxFiles = CHECKPOINT_MAX_FILES;
  const seen = new Set<string>();
  const rootResolved = cp.workspaceRoot;

  const walk = (absDir: string, relPosix: string): void => {
    if (seen.size >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (seen.size >= maxFiles) return;
      const name = ent.name;
      const childRel = relPosix ? `${relPosix}/${name}` : name;
      if (shouldIgnoreCheckpointPath(childRel)) continue;
      const childAbs = path.join(absDir, name);
      let isDir = ent.isDirectory();
      let isFile = ent.isFile();
      if (ent.isSymbolicLink()) {
        try {
          const st = fs.statSync(childAbs);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue;
        }
      }
      if (isDir) {
        walk(childAbs, childRel);
        continue;
      }
      if (!isFile) continue;
      seen.add(childRel);
      try {
        const st = fs.statSync(childAbs);
        if (st.size > maxBytes) continue;
        const buf = fs.readFileSync(childAbs);
        if (hasNullByte(buf)) continue;
        const cur = buf.toString("utf8");
        const prev = cp.baseline.get(childRel);
        if (prev === undefined || prev !== cur) {
          cp.touched.add(childRel);
        }
      } catch {
        // ignore unreadable
      }
    }
  };

  walk(rootResolved, "");

  // Files present at begin but missing now → deleted during turn
  for (const rel of cp.baseline.keys()) {
    if (!seen.has(rel)) cp.touched.add(rel);
  }
}

/** Finish whatever is still capturing for this session (e.g. on prompt_done). */
export function finishActiveCheckpoint(sessionId: string): CheckpointSummary | null {
  const key = activeBySession.get(sessionId);
  if (!key) return null;
  const cp = byKey.get(key);
  if (!cp) {
    activeBySession.delete(sessionId);
    return null;
  }
  return finishCheckpoint(cp.sessionId, cp.userMessageId);
}

export function getCheckpointSummary(
  sessionId: string,
  userMessageId: string,
): CheckpointSummary | null {
  const cp = byKey.get(keyOf(sessionId, userMessageId));
  return cp ? toSummary(cp) : null;
}

export function listReadyCheckpoints(sessionId: string): CheckpointSummary[] {
  const out: CheckpointSummary[] = [];
  for (const cp of byKey.values()) {
    if (cp.sessionId === sessionId && cp.status === "ready") out.push(toSummary(cp));
  }
  return out;
}

export type RevertResult = {
  ok: boolean;
  restored: number;
  deleted: number;
  skipped: number;
  error: string | null;
};

export function revertCheckpoint(
  sessionId: string,
  userMessageId: string,
  currentWorkspaceRoot: string | null,
): RevertResult {
  const cp = byKey.get(keyOf(sessionId, userMessageId));
  if (!cp) return { ok: false, restored: 0, deleted: 0, skipped: 0, error: "Checkpoint not found" };
  if (cp.status === "reverted") {
    return { ok: true, restored: 0, deleted: 0, skipped: 0, error: null };
  }
  if (cp.status !== "ready" && cp.status !== "empty") {
    return { ok: false, restored: 0, deleted: 0, skipped: 0, error: "Checkpoint not ready" };
  }
  if (cp.touched.size === 0) {
    cp.status = "reverted";
    return { ok: true, restored: 0, deleted: 0, skipped: 0, error: null };
  }

  if (!currentWorkspaceRoot || !rootsEqual(currentWorkspaceRoot, cp.workspaceRoot)) {
    return { ok: false, restored: 0, deleted: 0, skipped: 0, error: "Workspace changed" };
  }

  let restored = 0;
  let deleted = 0;
  let skipped = 0;

  for (const rel of cp.touched) {
    const abs = path.join(cp.workspaceRoot, ...rel.split("/"));
    const baseline = cp.baseline.get(rel);
    try {
      if (baseline === undefined) {
        // Created during turn → remove
        if (fs.existsSync(abs)) {
          const st = fs.statSync(abs);
          if (st.isFile()) {
            fs.unlinkSync(abs);
            deleted += 1;
          } else {
            skipped += 1;
          }
        }
      } else {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, baseline, "utf8");
        restored += 1;
      }
    } catch {
      skipped += 1;
    }
  }

  cp.status = "reverted";
  return { ok: true, restored, deleted, skipped, error: null };
}

function toSummary(cp: TurnCheckpoint): CheckpointSummary {
  return {
    sessionId: cp.sessionId,
    userMessageId: cp.userMessageId,
    status: cp.status,
    fileCount: cp.touched.size,
    skippedCount: cp.skippedAtBegin,
  };
}

/** Test helper */
export function _resetCheckpointsForTests(): void {
  byKey.clear();
  activeBySession.clear();
}

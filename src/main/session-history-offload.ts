/**
 * Off-main session history parsing via worker_threads.
 *
 * Uses a small persistent pool (spawn once, reuse across requests) instead of
 * a throwaway worker per job — thread startup + module load otherwise tax
 * every history page / dir scan.
 */
import { existsSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { join } from "node:path";
import type {
  SessionHistoryMessage,
  SessionHistoryPage,
} from "../shared/protocol";
import type { DiskSessionRow } from "./session-history-worker";

type WorkerReply =
  | { ok: true; messages: SessionHistoryMessage[] }
  | { ok: true; page: SessionHistoryPage }
  | { ok: true; sessions: DiskSessionRow[] }
  | { ok: false; error: string };

type WorkerReplyWithId = WorkerReply & { id?: number };

type PendingJob = {
  resolve: (msg: WorkerReply) => void;
  reject: (err: Error) => void;
};

type PooledWorker = {
  worker: Worker;
  pending: Map<number, PendingJob>;
};

function workerScriptPath(): string | null {
  // Prefer sibling of this module (packaged / electron-vite out/main).
  // Vitest runs from src/ — fall back to the built out/main worker when present.
  const candidates = [
    join(__dirname, "session-history-worker.js"),
    join(__dirname, "../../out/main/session-history-worker.js"),
  ];
  for (const candidate of candidates) {
    let p = candidate;
    if (p.includes("app.asar") && !p.includes("app.asar.unpacked")) {
      p = p.replace("app.asar", "app.asar.unpacked");
    }
    if (existsSync(p)) return p;
  }
  return null;
}

function workerUnavailable(): Error {
  return new Error("session-history worker not built (run electron-vite build)");
}

const MAX_POOL_SIZE = 2;
const IDLE_TERMINATE_MS = 30_000;
const pool: PooledWorker[] = [];
let nextJobId = 1;
let idleTimer: NodeJS.Timeout | null = null;

function armIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    for (let i = pool.length - 1; i >= 0; i--) {
      const entry = pool[i]!;
      if (entry.pending.size === 0) {
        pool.splice(i, 1);
        void entry.worker.terminate();
      }
    }
    if (pool.length > 0) armIdleTimer();
  }, IDLE_TERMINATE_MS);
  idleTimer.unref?.();
}

function spawnPooledWorker(scriptPath: string): PooledWorker {
  const entry: PooledWorker = { worker: new Worker(scriptPath), pending: new Map() };
  const { worker } = entry;
  worker.on("message", (msg: WorkerReplyWithId) => {
    const id = msg && typeof msg === "object" ? msg.id : undefined;
    let job: PendingJob | undefined;
    if (typeof id === "number") {
      job = entry.pending.get(id);
      if (job) entry.pending.delete(id);
    } else if (entry.pending.size > 0) {
      // Stale worker build that doesn't echo ids: jobs run sequentially, so
      // replies arrive in dispatch order — match FIFO.
      const oldest = entry.pending.keys().next();
      if (!oldest.done) {
        job = entry.pending.get(oldest.value);
        entry.pending.delete(oldest.value);
      }
    }
    if (!job) return;
    if (!msg || typeof msg !== "object") {
      job.reject(new Error("history worker: invalid reply"));
    } else if (!msg.ok) {
      job.reject(new Error(msg.error || "history parse failed"));
    } else {
      job.resolve(msg);
    }
    armIdleTimer();
  });
  const failAll = (err: Error): void => {
    for (const job of entry.pending.values()) job.reject(err);
    entry.pending.clear();
    const idx = pool.indexOf(entry);
    if (idx >= 0) pool.splice(idx, 1);
    armIdleTimer();
  };
  worker.on("error", (err) => {
    failAll(err instanceof Error ? err : new Error(String(err)));
  });
  worker.on("exit", (code) => {
    if (entry.pending.size === 0) {
      const idx = pool.indexOf(entry);
      if (idx >= 0) pool.splice(idx, 1);
      return;
    }
    failAll(new Error(`history worker exited (${code})`));
  });
  // Idle pooled workers must not keep the process (or a test run) alive.
  worker.unref();
  pool.push(entry);
  return entry;
}

function acquireWorker(scriptPath: string): PooledWorker {
  let idle: PooledWorker | null = null;
  let busiest: PooledWorker | null = null;
  for (const entry of pool) {
    if (!busiest || entry.pending.size < busiest.pending.size) busiest = entry;
    if (entry.pending.size === 0) idle = entry;
  }
  if (idle) return idle;
  if (pool.length < MAX_POOL_SIZE) return spawnPooledWorker(scriptPath);
  return busiest!;
}

function runHistoryWorker(job: {
  filePath?: string;
  page?: { limit?: number; beforeId?: string | null };
  listDir?: string;
  listAllUnder?: string;
}): Promise<WorkerReply> {
  const scriptPath = workerScriptPath();
  if (!scriptPath) return Promise.reject(workerUnavailable());
  const entry = acquireWorker(scriptPath);
  const id = nextJobId++;
  return new Promise((resolve, reject) => {
    entry.pending.set(id, { resolve, reject });
    entry.worker.postMessage({ ...job, id });
  });
}

/** Session dir scan + summary parse off the Electron main process. */
export function listSessionSummariesOffMain(job: {
  dir?: string;
  allUnder?: string;
}): Promise<DiskSessionRow[]> {
  return runHistoryWorker({
    listDir: job.dir,
    listAllUnder: job.allUnder,
  }).then((msg) => {
    if (msg.ok && "sessions" in msg && Array.isArray(msg.sessions)) {
      return msg.sessions;
    }
    throw new Error("history worker: expected sessions reply");
  });
}

/** Parse a session jsonl file off the Electron main process (full leaf path). */
export function parseHistoryOffMain(
  filePath: string,
): Promise<SessionHistoryMessage[]> {
  return runHistoryWorker({ filePath }).then((msg) => {
    if (!msg.ok || !("messages" in msg)) {
      throw new Error("history worker: expected full messages reply");
    }
    return Array.isArray(msg.messages) ? msg.messages : [];
  });
}

function sliceMessagesToPage(
  all: SessionHistoryMessage[],
  opts: { limit: number; beforeId?: string | null },
): SessionHistoryPage {
  const limit = Math.max(1, Math.min(200, opts.limit));
  const beforeId = opts.beforeId?.trim() || null;
  const total = all.length;
  if (total === 0) return { messages: [], hasMore: false, total: 0 };
  let end = total;
  if (beforeId) {
    const idx = all.findIndex((m) => m.id === beforeId);
    if (idx < 0 || idx === 0) return { messages: [], hasMore: false, total };
    end = idx;
  }
  const start = Math.max(0, end - limit);
  return {
    messages: all.slice(start, end),
    hasMore: start > 0,
    total,
  };
}

/** Paginated parse off the main process — images only for the returned window. */
export function parseHistoryPageOffMain(
  filePath: string,
  opts: { limit: number; beforeId?: string | null },
): Promise<SessionHistoryPage> {
  return runHistoryWorker({
    filePath,
    page: { limit: opts.limit, beforeId: opts.beforeId },
  }).then((msg) => {
    if (msg.ok && "page" in msg && msg.page) return msg.page;
    // Stale worker build may still reply with full `messages` — slice locally.
    if (msg.ok && "messages" in msg && Array.isArray(msg.messages)) {
      return sliceMessagesToPage(msg.messages, opts);
    }
    throw new Error("history worker: expected page reply");
  });
}

/**
 * Off-main session history parsing via worker_threads.
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

function workerScriptPath(): string {
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
  return candidates[0]!;
}

function runHistoryWorker(job: {
  filePath?: string;
  page?: { limit?: number; beforeId?: string | null };
  listDir?: string;
  listAllUnder?: string;
}): Promise<WorkerReply> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(workerScriptPath());

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      worker.removeAllListeners();
      void worker.terminate();
      fn();
    };

    worker.on("message", (msg: WorkerReply) => {
      if (!msg || typeof msg !== "object") {
        finish(() => reject(new Error("history worker: invalid reply")));
        return;
      }
      if (!msg.ok) {
        finish(() => reject(new Error(msg.error || "history parse failed")));
        return;
      }
      finish(() => resolve(msg));
    });
    worker.on("error", (err) => {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
    });
    worker.on("exit", (code) => {
      if (settled) return;
      finish(() => reject(new Error(`history worker exited (${code})`)));
    });

    worker.postMessage(job);
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

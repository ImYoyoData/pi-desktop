import type { WorkerOutbound } from "../shared/agent-worker-messages";
import {
  appendCappedTail,
  type AgentRunEvent,
  type AgentRunSnapshot,
} from "../shared/agent-runs";
import { isWindowHidden, onWindowShown } from "./window-visibility";

function normalizeRoot(root: string): string {
  return root.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export type AgentRunRegistry = {
  handleWorkerMessage: (sessionId: string, msg: WorkerOutbound) => void;
  list: (workspaceRoot: string) => AgentRunSnapshot[];
  terminate: (runId: string) => Promise<void>;
  background: (runId: string) => Promise<void>;
  endSessionRuns: (sessionId: string) => void;
  hasActiveRuns: (sessionId: string) => boolean;
};

export function createAgentRunRegistry(deps: {
  onEvent: (event: AgentRunEvent) => void;
  sendTerminate?: (sessionId: string, runId: string) => Promise<void>;
  sendBackground?: (sessionId: string, runId: string) => Promise<void>;
}): AgentRunRegistry {
  const runs = new Map<string, AgentRunSnapshot>();
  /** Batch high-frequency stdout into ~30fps IPC so the Running xterm can keep up. */
  const pendingOutput = new Map<string, { chunk: string; outputTail: string }>();
  let outputFlushTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Cap a pending output batch per run. webContents.send serializes synchronously
   * in the main process — an uncapped chunk (e.g. `npm run build` dumping MBs)
   * freezes the whole app for every flush. Keep the newest data: the Running
   * panel renders the tail, not the middle.
   */
  const MAX_PENDING_CHUNK = 64 * 1024;

  function flushPendingOutput(): void {
    if (outputFlushTimer != null) {
      clearTimeout(outputFlushTimer);
      outputFlushTimer = null;
    }
    if (!pendingOutput.size) return;
    // No window is visible (e.g. minimized): hold output and stop IPC so
    // restoring the window does not burst a backlog of synchronous sends.
    if (isWindowHidden()) {
      outputFlushTimer = setTimeout(flushPendingOutput, 250);
      return;
    }
    const batch = [...pendingOutput.entries()];
    pendingOutput.clear();
    for (const [runId, payload] of batch) {
      deps.onEvent({
        type: "output",
        runId,
        chunk: payload.chunk,
        outputTail: payload.outputTail,
      });
    }
  }

  function queueOutput(runId: string, chunk: string, outputTail: string): void {
    const prev = pendingOutput.get(runId);
    const prevChunk = prev?.chunk ?? "";
    let nextChunk: string;
    if (prevChunk.length + chunk.length > MAX_PENDING_CHUNK) {
      if (chunk.length >= MAX_PENDING_CHUNK) {
        nextChunk = chunk.slice(chunk.length - MAX_PENDING_CHUNK);
      } else {
        nextChunk =
          prevChunk.slice(prevChunk.length - (MAX_PENDING_CHUNK - chunk.length)) +
          chunk;
      }
    } else {
      nextChunk = prevChunk + chunk;
    }
    pendingOutput.set(runId, { chunk: nextChunk, outputTail });
    if (outputFlushTimer != null) return;
    outputFlushTimer = setTimeout(flushPendingOutput, 32);
  }

  function handleWorkerMessage(sessionId: string, msg: WorkerOutbound): void {
    if (msg.kind === "run_started") {
      const existing = runs.get(msg.run.id);
      const startedAt = existing?.startedAt ?? msg.run.startedAt;
      const snap: AgentRunSnapshot = {
        id: msg.run.id,
        sessionId: msg.run.sessionId || sessionId,
        workspaceRoot: normalizeRoot(msg.run.workspaceRoot),
        command: msg.run.command,
        cwd: msg.run.cwd,
        pid: msg.run.pid ?? existing?.pid,
        startedAt,
        status: existing?.status === "terminating" ? "terminating" : "running",
        // Preserve already-streamed stdout when the worker re-emits start with a pid.
        outputTail: existing?.outputTail ?? "",
        lastOutputAt: existing?.lastOutputAt ?? startedAt,
        detached: existing?.detached ?? false,
      };
      runs.set(snap.id, snap);
      deps.onEvent({ type: "upsert", run: { ...snap } });
      return;
    }

    if (msg.kind === "run_output") {
      const existing = runs.get(msg.runId);
      if (!existing) return;
      const outputTail = appendCappedTail(existing.outputTail, msg.chunk);
      const next: AgentRunSnapshot = {
        ...existing,
        outputTail,
        lastOutputAt: Date.now(),
      };
      runs.set(msg.runId, next);
      queueOutput(msg.runId, msg.chunk, outputTail);
      return;
    }

    if (msg.kind === "run_backgrounded") {
      // Flush buffered stdout before marking detached so the UI doesn't lag behind.
      // While hidden, the panel is not visible — drop the batch instead.
      if (pendingOutput.has(msg.runId) && !isWindowHidden()) flushPendingOutput();
      else pendingOutput.delete(msg.runId);
      const existing = runs.get(msg.runId);
      if (!existing) return;
      const next: AgentRunSnapshot = { ...existing, detached: true };
      runs.set(msg.runId, next);
      deps.onEvent({ type: "upsert", run: { ...next } });
      return;
    }

    if (msg.kind === "run_ended") {
      if (pendingOutput.has(msg.runId) && !isWindowHidden()) flushPendingOutput();
      else pendingOutput.delete(msg.runId);
      if (!runs.has(msg.runId)) return;
      runs.delete(msg.runId);
      deps.onEvent({ type: "ended", runId: msg.runId });
    }
  }

  // Drain anything buffered while the window was hidden as soon as it shows.
  onWindowShown(() => {
    if (pendingOutput.size && outputFlushTimer == null) {
      flushPendingOutput();
    }
  });

  function list(workspaceRoot: string): AgentRunSnapshot[] {
    const key = normalizeRoot(workspaceRoot ?? "");
    return [...runs.values()]
      .filter((r) => r.workspaceRoot === key)
      .map((r) => ({ ...r }));
  }

  async function terminate(runId: string): Promise<void> {
    const existing = runs.get(runId);
    if (!existing) return;
    const next: AgentRunSnapshot = { ...existing, status: "terminating" };
    runs.set(runId, next);
    deps.onEvent({ type: "upsert", run: { ...next } });
    try {
      await deps.sendTerminate?.(existing.sessionId, runId);
    } catch (err) {
      const current = runs.get(runId);
      if (current?.status === "terminating") {
        const rolled: AgentRunSnapshot = { ...current, status: "running" };
        runs.set(runId, rolled);
        deps.onEvent({ type: "upsert", run: { ...rolled } });
      }
      throw err;
    }
  }

  async function background(runId: string): Promise<void> {
    const existing = runs.get(runId);
    if (!existing || existing.detached) return;
    await deps.sendBackground?.(existing.sessionId, runId);
  }

  function endSessionRuns(sessionId: string): void {
    for (const [id, run] of [...runs.entries()]) {
      if (run.sessionId !== sessionId) continue;
      runs.delete(id);
      deps.onEvent({ type: "ended", runId: id });
    }
  }

  function hasActiveRuns(sessionId: string): boolean {
    for (const run of runs.values()) {
      if (run.sessionId === sessionId) return true;
    }
    return false;
  }

  return {
    handleWorkerMessage,
    list,
    terminate,
    background,
    endSessionRuns,
    hasActiveRuns,
  };
}

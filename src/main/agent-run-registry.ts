import type { WorkerOutbound } from "../shared/agent-worker-messages";
import {
  appendCappedTail,
  type AgentRunEvent,
  type AgentRunSnapshot,
} from "../shared/agent-runs";

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

  function handleWorkerMessage(sessionId: string, msg: WorkerOutbound): void {
    if (msg.kind === "run_started") {
      const snap: AgentRunSnapshot = {
        id: msg.run.id,
        sessionId: msg.run.sessionId || sessionId,
        workspaceRoot: normalizeRoot(msg.run.workspaceRoot),
        command: msg.run.command,
        cwd: msg.run.cwd,
        pid: msg.run.pid,
        startedAt: msg.run.startedAt,
        status: "running",
        outputTail: "",
        detached: false,
      };
      runs.set(snap.id, snap);
      deps.onEvent({ type: "upsert", run: { ...snap } });
      return;
    }

    if (msg.kind === "run_output") {
      const existing = runs.get(msg.runId);
      if (!existing) return;
      const outputTail = appendCappedTail(existing.outputTail, msg.chunk);
      const next: AgentRunSnapshot = { ...existing, outputTail };
      runs.set(msg.runId, next);
      deps.onEvent({ type: "output", runId: msg.runId, chunk: msg.chunk, outputTail });
      return;
    }

    if (msg.kind === "run_backgrounded") {
      const existing = runs.get(msg.runId);
      if (!existing) return;
      const next: AgentRunSnapshot = { ...existing, detached: true };
      runs.set(msg.runId, next);
      deps.onEvent({ type: "upsert", run: { ...next } });
      return;
    }

    if (msg.kind === "run_ended") {
      if (!runs.has(msg.runId)) return;
      runs.delete(msg.runId);
      deps.onEvent({ type: "ended", runId: msg.runId });
    }
  }

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

import { randomUUID } from "node:crypto";
import path from "node:path";
import type { WorkerInbound, WorkerOutbound } from "../shared/agent-worker-messages";
import type { AgentCommand, AgentEvent, SessionStatus, SessionSummary } from "../shared/protocol";
import { listSessionsForCwd } from "./session-list";

const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_MISS_LIMIT = 3;

export type WorkerHandle = {
  send: (msg: WorkerInbound) => Promise<WorkerOutbound | null>;
  kill: () => void;
  onMessage: (cb: (msg: WorkerOutbound) => void) => () => void;
};

export type SpawnWorker = (
  cwd: string,
  filePath?: string,
) => Promise<{ worker: WorkerHandle; id: string; filePath: string; cwd: string }>;

export type SessionBroker = {
  createSession: (cwd: string) => Promise<SessionSummary>;
  listSessions: (cwd: string) => Promise<SessionSummary[]>;
  openSession: (sessionId: string, cwd: string) => Promise<SessionSummary | null>;
  closeSession: (sessionId: string) => Promise<void>;
  send: (sessionId: string, command: AgentCommand) => Promise<void>;
  killWorker: (sessionId: string) => Promise<void>;
  restartWorker: (sessionId: string) => Promise<void>;
  onEvent: (cb: (event: AgentEvent) => void) => () => void;
};

type SessionRecord = {
  cwd: string;
  summary: SessionSummary;
  worker: WorkerHandle;
  heartbeatMisses: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  pendingCommands: Map<
    string,
    { command: AgentCommand; resolve: () => void; reject: (err: Error) => void }
  >;
};

export function createSessionBroker(deps: { spawnWorker: SpawnWorker }): SessionBroker {
  const sessions = new Map<string, SessionRecord>();
  const listeners = new Set<(event: AgentEvent) => void>();

  function emit(event: AgentEvent): void {
    for (const cb of listeners) {
      cb(event);
    }
  }

  function setStatus(sessionId: string, status: SessionStatus): void {
    const rec = sessions.get(sessionId);
    if (!rec || rec.summary.status === status) {
      return;
    }
    rec.summary.status = status;
  }

  function stopHeartbeat(rec: SessionRecord): void {
    if (rec.heartbeatTimer) {
      clearInterval(rec.heartbeatTimer);
      rec.heartbeatTimer = null;
    }
  }

  function startHeartbeat(sessionId: string): void {
    const rec = sessions.get(sessionId);
    if (!rec) {
      return;
    }
    stopHeartbeat(rec);
    rec.heartbeatMisses = 0;
    rec.heartbeatTimer = setInterval(() => {
      const current = sessions.get(sessionId);
      if (!current) {
        return;
      }
      current.heartbeatMisses += 1;
      if (current.heartbeatMisses >= HEARTBEAT_MISS_LIMIT) {
        setStatus(sessionId, "stuck");
        emit({ type: "worker_stuck", sessionId });
      }
      void current.worker.send({ kind: "ping" });
    }, HEARTBEAT_INTERVAL_MS);
  }

  function attachWorker(sessionId: string, worker: WorkerHandle): void {
    worker.onMessage((msg) => {
      const rec = sessions.get(sessionId);
      if (!rec) {
        return;
      }

      if (msg.kind === "pong") {
        rec.heartbeatMisses = 0;
        if (rec.summary.status === "stuck") {
          setStatus(sessionId, "idle");
        }
        return;
      }

      if (msg.kind === "event" && msg.event) {
        emit({ type: "agent_event", sessionId, event: msg.event });
        return;
      }

      if (msg.kind === "fatal") {
        setStatus(sessionId, "error");
        emit({
          type: "prompt_error",
          sessionId,
          errorMessage: msg.error ?? "worker fatal",
        });
        return;
      }

      if (msg.kind === "result" && msg.id) {
        const pending = rec.pendingCommands.get(msg.id);
        if (!pending) {
          return;
        }
        rec.pendingCommands.delete(msg.id);
        if (msg.error) {
          setStatus(sessionId, "error");
          emit({ type: "prompt_error", sessionId, errorMessage: msg.error });
          pending.reject(new Error(msg.error));
          return;
        }
        pending.resolve();
        if (pending.command.type === "prompt") {
          setStatus(sessionId, "idle");
          emit({ type: "prompt_done", sessionId });
        } else if (pending.command.type === "hang") {
          setStatus(sessionId, "idle");
        }
      }
    });
  }

  function registerWorkerSession(
    id: string,
    cwd: string,
    filePath: string,
    worker: WorkerHandle,
  ): SessionSummary {
    const summary: SessionSummary = {
      id,
      cwd,
      filePath,
      modified: new Date().toISOString(),
      status: "idle",
    };
    sessions.set(id, {
      cwd,
      summary,
      worker,
      heartbeatMisses: 0,
      heartbeatTimer: null,
      pendingCommands: new Map(),
    });
    attachWorker(id, worker);
    startHeartbeat(id);
    emit({ type: "connected", sessionId: id });
    return { ...summary };
  }

  async function createSession(cwd: string): Promise<SessionSummary> {
    const spawned = await deps.spawnWorker(cwd);
    return registerWorkerSession(spawned.id, spawned.cwd, spawned.filePath, spawned.worker);
  }

  async function listSessions(cwd: string): Promise<SessionSummary[]> {
    const disk = await listSessionsForCwd(cwd);
    const merged = new Map<string, SessionSummary>();
    for (const row of disk) {
      merged.set(row.id, { ...row });
    }
    for (const rec of sessions.values()) {
      if (path.resolve(rec.cwd) !== path.resolve(cwd)) {
        continue;
      }
      const existing = merged.get(rec.summary.id);
      merged.set(rec.summary.id, {
        ...(existing ?? rec.summary),
        ...rec.summary,
        status: rec.summary.status,
      });
    }
    return [...merged.values()].sort((a, b) => b.modified.localeCompare(a.modified));
  }

  async function openSession(sessionId: string, cwd: string): Promise<SessionSummary | null> {
    const live = sessions.get(sessionId);
    if (live) {
      return { ...live.summary };
    }
    const disk = await listSessionsForCwd(cwd);
    const target = disk.find((s) => s.id === sessionId);
    if (!target?.filePath) {
      return null;
    }
    const spawned = await deps.spawnWorker(cwd, target.filePath);
    if (spawned.id !== sessionId) {
      spawned.worker.kill();
      throw new Error(`session id mismatch: expected ${sessionId}, got ${spawned.id}`);
    }
    return registerWorkerSession(spawned.id, spawned.cwd, spawned.filePath, spawned.worker);
  }

  async function teardownWorker(sessionId: string, code: number | null): Promise<void> {
    const rec = sessions.get(sessionId);
    if (!rec) {
      return;
    }
    stopHeartbeat(rec);
    rec.worker.kill();
    emit({ type: "worker_exit", sessionId, code });
  }

  async function closeSession(sessionId: string): Promise<void> {
    const rec = sessions.get(sessionId);
    if (!rec) {
      return;
    }
    await rec.worker.send({ kind: "shutdown" });
    await teardownWorker(sessionId, 0);
    sessions.delete(sessionId);
  }

  async function send(sessionId: string, command: AgentCommand): Promise<void> {
    const rec = sessions.get(sessionId);
    if (!rec) {
      throw new Error(`unknown session: ${sessionId}`);
    }
    if (command.type === "prompt" || command.type === "hang") {
      setStatus(sessionId, "running");
    }
    const cmdId = randomUUID();
    const awaitsResult = command.type === "prompt" || command.type === "hang";
    const outbound = { kind: "command" as const, id: cmdId, command };

    if (!awaitsResult) {
      await rec.worker.send(outbound);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      rec.pendingCommands.set(cmdId, { command, resolve, reject });
      void rec.worker.send(outbound).then((direct) => {
        if (direct?.kind === "result") {
          const pending = rec.pendingCommands.get(cmdId);
          if (!pending) {
            return;
          }
          rec.pendingCommands.delete(cmdId);
          if (direct.error) {
            reject(new Error(direct.error));
          } else {
            resolve();
          }
        }
      });
    });
  }

  async function killWorker(sessionId: string): Promise<void> {
    const rec = sessions.get(sessionId);
    if (!rec) {
      return;
    }
    stopHeartbeat(rec);
    rec.worker.kill();
    setStatus(sessionId, "error");
    emit({ type: "worker_exit", sessionId, code: null });
  }

  async function restartWorker(sessionId: string): Promise<void> {
    const rec = sessions.get(sessionId);
    if (!rec) {
      return;
    }
    const { cwd, summary } = rec;
    const filePath = summary.filePath || undefined;
    stopHeartbeat(rec);
    rec.worker.kill();
    rec.pendingCommands.forEach(({ reject }) => reject(new Error("worker restarted")));
    rec.pendingCommands.clear();
    const spawned = await deps.spawnWorker(cwd, filePath);
    rec.worker = spawned.worker;
    rec.summary.filePath = spawned.filePath;
    attachWorker(sessionId, spawned.worker);
    startHeartbeat(sessionId);
    setStatus(sessionId, "idle");
  }

  function onEvent(cb: (event: AgentEvent) => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  return {
    createSession,
    listSessions,
    openSession,
    closeSession,
    send,
    killWorker,
    restartWorker,
    onEvent,
  };
}

import path from "node:path";
import type { WorkerInbound, WorkerOutbound } from "../shared/agent-worker-messages";
import type { AgentCommand, AgentEvent, SessionStatus, SessionSummary } from "../shared/protocol";
import { IDLE_WORKER_DESTROY_MS } from "./worker-lifecycle";
import { listSessionsForCwd } from "./session-list";
import { deleteSessionFile } from "./session-history";

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
  send: (sessionId: string, command: AgentCommand) => Promise<unknown>;
  killWorker: (sessionId: string) => Promise<void>;
  restartWorker: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string, cwd: string) => Promise<void>;
  notifyWorkersReloadModels: () => Promise<void>;
  /** Update in-memory session metadata (e.g. after rename on disk). */
  patchSummary: (
    sessionId: string,
    patch: Partial<Pick<SessionSummary, "name" | "firstMessage" | "modified">>,
  ) => SessionSummary | null;
  onEvent: (cb: (event: AgentEvent) => void) => () => void;
};

type SessionRecord = {
  cwd: string;
  summary: SessionSummary;
  worker: WorkerHandle | null;
  heartbeatMisses: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  idleDestroyTimer: ReturnType<typeof setTimeout> | null;
  pendingCommands: Map<
    string,
    {
      command: AgentCommand;
      resolve: (data?: unknown) => void;
      reject: (err: Error) => void;
    }
  >;
};

export function createSessionBroker(deps: {
  spawnWorker: SpawnWorker;
  idleDestroyMs?: number;
}): SessionBroker {
  const idleDestroyMs = deps.idleDestroyMs ?? IDLE_WORKER_DESTROY_MS;
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
    if (status === "running" || status === "stuck") {
      clearIdleDestroyTimer(rec);
    }
    emit({ type: "session_status", sessionId, status });
  }

  function rejectPendingCommands(rec: SessionRecord, message: string): void {
    rec.pendingCommands.forEach(({ reject }) => reject(new Error(message)));
    rec.pendingCommands.clear();
  }

  function clearIdleDestroyTimer(rec: SessionRecord): void {
    if (rec.idleDestroyTimer) {
      clearTimeout(rec.idleDestroyTimer);
      rec.idleDestroyTimer = null;
    }
  }

  function scheduleIdleDestroy(sessionId: string): void {
    const rec = sessions.get(sessionId);
    if (!rec || !rec.worker || rec.summary.status !== "idle") {
      return;
    }
    clearIdleDestroyTimer(rec);
    rec.idleDestroyTimer = setTimeout(() => {
      destroyIdleWorker(sessionId);
    }, idleDestroyMs);
  }

  function destroyIdleWorker(sessionId: string): void {
    const rec = sessions.get(sessionId);
    if (!rec || !rec.worker || rec.summary.status !== "idle") {
      return;
    }
    stopHeartbeat(rec);
    clearIdleDestroyTimer(rec);
    rec.worker.kill();
    rec.worker = null;
  }

  function stopHeartbeat(rec: SessionRecord): void {
    if (rec.heartbeatTimer) {
      clearInterval(rec.heartbeatTimer);
      rec.heartbeatTimer = null;
    }
  }

  function startHeartbeat(sessionId: string): void {
    const rec = sessions.get(sessionId);
    if (!rec?.worker) {
      return;
    }
    stopHeartbeat(rec);
    rec.heartbeatMisses = 0;
    rec.heartbeatTimer = setInterval(() => {
      const current = sessions.get(sessionId);
      if (!current?.worker) {
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

  async function spawnWorkerForRecord(
    sessionId: string,
    rec: SessionRecord,
  ): Promise<void> {
    const filePath = rec.summary.filePath || undefined;
    const spawned = await deps.spawnWorker(rec.cwd, filePath);
    if (spawned.id !== sessionId) {
      spawned.worker.kill();
      throw new Error(`session id mismatch: expected ${sessionId}, got ${spawned.id}`);
    }
    rec.worker = spawned.worker;
    rec.summary.filePath = spawned.filePath;
    attachWorker(sessionId, spawned.worker);
    startHeartbeat(sessionId);
    scheduleIdleDestroy(sessionId);
    emit({ type: "connected", sessionId });
  }

  async function ensureWorker(sessionId: string): Promise<SessionRecord> {
    const rec = sessions.get(sessionId);
    if (!rec) {
      throw new Error(`unknown session: ${sessionId}`);
    }
    if (rec.worker) {
      return rec;
    }
    await spawnWorkerForRecord(sessionId, rec);
    return rec;
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
          scheduleIdleDestroy(sessionId);
        }
        return;
      }

      if (msg.kind === "event" && msg.event) {
        const ev = msg.event as {
          type?: unknown;
          tokens?: unknown;
          contextWindow?: unknown;
          percent?: unknown;
          willRetry?: unknown;
        };
        if (ev.type === "context_usage" && typeof ev.contextWindow === "number") {
          emit({
            type: "context_usage",
            sessionId,
            usage: {
              tokens: typeof ev.tokens === "number" ? ev.tokens : null,
              contextWindow: ev.contextWindow,
              percent: typeof ev.percent === "number" ? ev.percent : null,
            },
          });
          return;
        }
        emit({ type: "agent_event", sessionId, event: msg.event });
        // Keep broker status aligned with agent lifecycle (not only prompt IPC result).
        if (ev.type === "agent_start" || ev.type === "turn_start") {
          setStatus(sessionId, "running");
        } else if (ev.type === "agent_end" && !ev.willRetry) {
          // May still auto-compact / continue before agent_settled — don't destroy worker yet.
          setStatus(sessionId, "idle");
        } else if (ev.type === "agent_settled") {
          setStatus(sessionId, "idle");
          scheduleIdleDestroy(sessionId);
        }
        return;
      }

      if (msg.kind === "fatal") {
        rejectPendingCommands(rec, msg.error ?? "worker fatal");
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
          // Prompt/command failure ends the turn — UI should not stay "running".
          setStatus(sessionId, pending.command.type === "prompt" ? "idle" : "error");
          emit({ type: "prompt_error", sessionId, errorMessage: msg.error });
          pending.reject(new Error(msg.error));
          return;
        }
        pending.resolve(msg.data);
        if (pending.command.type === "prompt") {
          setStatus(sessionId, "idle");
          emit({ type: "prompt_done", sessionId });
          scheduleIdleDestroy(sessionId);
        } else if (pending.command.type === "hang") {
          setStatus(sessionId, "idle");
          scheduleIdleDestroy(sessionId);
        }
      }
    });
  }

  function registerWorkerSession(
    id: string,
    cwd: string,
    filePath: string,
    worker: WorkerHandle,
    meta?: Partial<Pick<SessionSummary, "name" | "firstMessage" | "modified">>,
  ): SessionSummary {
    const summary: SessionSummary = {
      id,
      cwd,
      filePath,
      name: meta?.name,
      firstMessage: meta?.firstMessage,
      modified: meta?.modified ?? new Date().toISOString(),
      status: "idle",
    };
    sessions.set(id, {
      cwd,
      summary,
      worker,
      heartbeatMisses: 0,
      heartbeatTimer: null,
      idleDestroyTimer: null,
      pendingCommands: new Map(),
    });
    attachWorker(id, worker);
    startHeartbeat(id);
    scheduleIdleDestroy(id);
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
      // Live status/path win, but never let undefined live name/firstMessage
      // clobber values already loaded from disk (rename writes disk first — #3).
      merged.set(rec.summary.id, {
        ...(existing ?? rec.summary),
        ...rec.summary,
        name: rec.summary.name ?? existing?.name,
        firstMessage: rec.summary.firstMessage ?? existing?.firstMessage,
        filePath: rec.summary.filePath || existing?.filePath || "",
        modified:
          existing?.modified && rec.summary.modified
            ? rec.summary.modified > existing.modified
              ? rec.summary.modified
              : existing.modified
            : (rec.summary.modified ?? existing?.modified ?? new Date().toISOString()),
        status: rec.summary.status,
      });
    }
    return [...merged.values()].sort((a, b) => b.modified.localeCompare(a.modified));
  }

  function patchSummary(
    sessionId: string,
    patch: Partial<Pick<SessionSummary, "name" | "firstMessage" | "modified">>,
  ): SessionSummary | null {
    const rec = sessions.get(sessionId);
    if (!rec) return null;
    if (patch.name !== undefined) rec.summary.name = patch.name;
    if (patch.firstMessage !== undefined) rec.summary.firstMessage = patch.firstMessage;
    if (patch.modified !== undefined) rec.summary.modified = patch.modified;
    return { ...rec.summary };
  }

  async function openSession(sessionId: string, cwd: string): Promise<SessionSummary | null> {
    const live = sessions.get(sessionId);
    if (live?.worker) {
      // Always re-sync title/first message from disk — rename may have updated the file
      // while the live summary still had empty metadata (#3).
      const disk = await listSessionsForCwd(cwd);
      const target = disk.find((s) => s.id === sessionId);
      if (target) {
        if (target.name?.trim()) live.summary.name = target.name;
        if (target.firstMessage?.trim()) live.summary.firstMessage = target.firstMessage;
        live.summary.modified = target.modified;
      }
      return { ...live.summary };
    }
    if (live && !live.worker) {
      await spawnWorkerForRecord(sessionId, live);
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
    return registerWorkerSession(spawned.id, spawned.cwd, spawned.filePath, spawned.worker, {
      name: target.name,
      firstMessage: target.firstMessage,
      modified: target.modified,
    });
  }

  async function teardownWorker(sessionId: string, code: number | null): Promise<void> {
    const rec = sessions.get(sessionId);
    if (!rec) {
      return;
    }
    clearIdleDestroyTimer(rec);
    stopHeartbeat(rec);
    if (rec.worker) {
      rec.worker.kill();
    }
    emit({ type: "worker_exit", sessionId, code });
  }

  async function closeSession(sessionId: string): Promise<void> {
    const rec = sessions.get(sessionId);
    if (!rec) {
      return;
    }
    if (rec.worker) {
      await rec.worker.send({ kind: "shutdown" });
    }
    await teardownWorker(sessionId, 0);
    sessions.delete(sessionId);
  }

  async function send(sessionId: string, command: AgentCommand): Promise<unknown> {
    const rec = await ensureWorker(sessionId);
    const worker = rec.worker;
    if (!worker) {
      throw new Error(`session worker unavailable: ${sessionId}`);
    }
    if (command.type === "prompt" || command.type === "hang") {
      setStatus(sessionId, "running");
    }
    const cmdId = crypto.randomUUID();
    // Wait for worker result for mutating commands so errors (e.g. set_model) surface to UI.
    const awaitsResult =
      command.type === "prompt" ||
      command.type === "hang" ||
      command.type === "set_model" ||
      command.type === "set_thinking_level" ||
      command.type === "compact" ||
      command.type === "steer" ||
      command.type === "follow_up" ||
      command.type === "abort" ||
      command.type === "get_state";
    const outbound = { kind: "command" as const, id: cmdId, command };

    if (!awaitsResult) {
      await worker.send(outbound);
      return undefined;
    }

    return await new Promise<unknown>((resolve, reject) => {
      rec.pendingCommands.set(cmdId, { command, resolve, reject });
      void worker.send(outbound).then((direct) => {
        if (direct?.kind === "result") {
          const pending = rec.pendingCommands.get(cmdId);
          if (!pending) {
            return;
          }
          rec.pendingCommands.delete(cmdId);
          if (direct.error) {
            reject(new Error(direct.error));
          } else {
            resolve(direct.data);
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
    clearIdleDestroyTimer(rec);
    stopHeartbeat(rec);
    rejectPendingCommands(rec, "worker terminated");
    if (rec.worker) {
      rec.worker.kill();
      rec.worker = null;
    }
    setStatus(sessionId, "error");
    emit({ type: "worker_exit", sessionId, code: null });
  }

  async function restartWorker(sessionId: string): Promise<void> {
    const rec = sessions.get(sessionId);
    if (!rec) {
      return;
    }
    clearIdleDestroyTimer(rec);
    stopHeartbeat(rec);
    rejectPendingCommands(rec, "worker restarted");
    if (rec.worker) {
      rec.worker.kill();
      rec.worker = null;
    }
    await spawnWorkerForRecord(sessionId, rec);
    setStatus(sessionId, "idle");
  }

  async function deleteSession(sessionId: string, cwd: string): Promise<void> {
    const rec = sessions.get(sessionId);
    let filePath = rec?.summary.filePath;
    if (!filePath) {
      const disk = await listSessionsForCwd(cwd);
      filePath = disk.find((s) => s.id === sessionId)?.filePath;
    }
    if (rec?.worker) {
      clearIdleDestroyTimer(rec);
      stopHeartbeat(rec);
      rejectPendingCommands(rec, "session deleted");
      rec.worker.kill();
      rec.worker = null;
    }
    sessions.delete(sessionId);
    if (filePath) {
      try {
        await deleteSessionFile(filePath);
      } catch {
        // file may already be gone
      }
    }
  }

  function onEvent(cb: (event: AgentEvent) => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  async function notifyWorkersReloadModels(): Promise<void> {
    // AuthStorage caches auth.json in memory at worker start. ModelRuntime.refresh()
    // does not call AuthStorage.reload(), so a live worker keeps empty credentials
    // after the main process writes a new API key — until restart (matches issue #2).
    const ids = [...sessions.entries()]
      .filter(([, rec]) => rec.worker !== null)
      .map(([id]) => id);
    for (const id of ids) {
      await restartWorker(id);
    }
  }

  return {
    createSession,
    listSessions,
    openSession,
    closeSession,
    send,
    killWorker,
    restartWorker,
    deleteSession,
    notifyWorkersReloadModels,
    patchSummary,
    onEvent,
  };
}

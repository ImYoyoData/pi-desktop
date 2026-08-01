import path from "node:path";
import { existsSync } from "node:fs";
import type { WorkerInbound, WorkerOutbound } from "../shared/agent-worker-messages";
import type { DesktopSecuritySettings } from "../shared/desktop-security";
import type {
  AgentCommand,
  AgentEvent,
  ContextUsageSegment,
  ContextUsageSegmentId,
  SessionStatus,
  SessionSummary,
  type SessionImageCacheResult,
  type SessionImageCacheSource,
} from "../shared/protocol";
import { IDLE_WORKER_DESTROY_MS } from "./worker-lifecycle";
import { listSessionsForCwd } from "./session-list";
import { clearSessionConversation, deleteSessionFile, invalidateSessionHistoryCache } from "./session-history";
import { appendChatMeta } from "./session-chat-meta";
import type { ChatMessageTag } from "../shared/chat-meta";
import { downloadImageToCache, saveImageDataUrl } from "./session-image-cache";
import { deleteImageFile } from "./session-image-cache";
import { allocateSessionOnDisk } from "./session-allocate";

const HEARTBEAT_INTERVAL_MS = 5_000;
/**
 * Keep at most this many idle workers alive. Prewarm spawns one utilityProcess
 * per opened session; without a cap, clicking through many sessions left dozens
 * of Pi agent processes running (users saw 70+ child processes).
 */
const MAX_IDLE_WORKERS = 4;
/** Idle workers only: ~15s of silence → stuck (catch wedged utilityProcess). */
const HEARTBEAT_MISS_LIMIT_IDLE = 3;
/**
 * Active agent turns are never killed by heartbeat silence.
 * Pi SDK / long tools often block the worker event loop so pongs stall even while
 * work is progressing — mid-turn stuck was a false positive that aborted live runs.
 * Real deaths still surface via exit/fatal; Stop uses abort force-kill; renderer
 * soft-hang covers "worker alive but no output" without killing mid-tool.
 *
 * A turn whose event loop stays silent past STALL_EMIT_MS is beyond "slow work":
 * the worker answers pings before any command work, so 75s of zero messages means
 * the loop is wedged (e.g. stdout pipe backpressure, deadlock, OOM thrash). Emit
 * worker_stall (never kill mid-turn) so the renderer can abort + restart + resend.
 */
export const STALL_EMIT_MS = 75_000;
const ABORT_FORCE_KILL_MS = 4_000;
const SHUTDOWN_GRACE_MS = 800;
const CONTEXT_SEGMENT_IDS = new Set<ContextUsageSegmentId>([
  "system",
  "tools",
  "summarized",
  "conversation",
  "toolResults",
]);

export type WorkerHandle = {
  send: (msg: WorkerInbound) => Promise<WorkerOutbound | null>;
  kill: () => void;
  onMessage: (cb: (msg: WorkerOutbound) => void) => () => void;
};

export type SpawnWorker = (
  cwd: string,
  filePath?: string,
) => Promise<{ worker: WorkerHandle; id: string; filePath: string; cwd: string }>;

/** Allocate session id + jsonl without spawning the Pi agent worker. */
export type AllocateSession = (cwd: string) => Promise<{
  id: string;
  cwd: string;
  filePath: string;
}>;

export type SessionBroker = {
  createSession: (cwd: string) => Promise<SessionSummary>;
  listSessions: (cwd: string) => Promise<SessionSummary[]>;
  openSession: (sessionId: string, cwd: string) => Promise<SessionSummary | null>;
  closeSession: (sessionId: string) => Promise<void>;
  send: (sessionId: string, command: AgentCommand) => Promise<unknown>;
  /**
   * Like send, but never cold-starts a worker. Returns `undefined` when no worker is alive
   * (used for UI sync without waking the Pi agent).
   */
  trySend: (sessionId: string, command: AgentCommand) => Promise<unknown | undefined>;
  /** Fire-and-forget worker message (no pending-command tracking). */
  sendRaw: (sessionId: string, msg: WorkerInbound) => Promise<WorkerOutbound | null>;
  /**
   * Send to a live worker only — never cold-starts via ensureWorker/spawn.
   * Returns false when no worker is alive for the session.
   */
  sendRawIfAlive: (sessionId: string, msg: WorkerInbound) => Promise<boolean>;
  killWorker: (sessionId: string) => Promise<void>;
  restartWorker: (sessionId: string) => Promise<void>;
  /** Restart live workers for a workspace so `projectTrusted` / init snapshot reloads. */
  restartWorkersForCwd: (cwd: string) => Promise<void>;
  deleteSession: (sessionId: string, cwd: string) => Promise<void>;
  /** Wipe chat history for a session (disk + live worker) while keeping the same session id. */
  clearContext: (sessionId: string, cwd: string) => Promise<void>;
  notifyWorkersReloadModels: () => Promise<void>;
  /** Hot-reload desktopSecurity into live workers (no restart). */
  notifyWorkersReloadSecurity: (desktopSecurity: DesktopSecuritySettings) => Promise<void>;
  /** Delete one cached image file (user removed it from the editor). */
  deleteCachedImage: (sessionId: string, cachePath: string) => void;
  /** Cache a pasted / URL image into the session's attachment folder. */
  cacheImage: (
    sessionId: string,
    source: SessionImageCacheSource,
  ) => Promise<SessionImageCacheResult>;
  /** Persist attachment tags for a sent user message (chat reload restores chips). */
  persistUserMessageMeta: (
    sessionId: string,
    text: string,
    tags: ChatMessageTag[],
  ) => void;
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
  /** In-flight spawn (prewarm or cold start) — dedupes concurrent spawns. */
  workerPromise: Promise<void> | null;
  /** Wall-clock ms when the current worker was spawned (for idle-worker trimming). */
  spawnedAt: number;
  /** Wall-clock ms of last message from this worker (any kind). */
  lastAliveAt: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  idleDestroyTimer: ReturnType<typeof setTimeout> | null;
  /** True once worker_stall was emitted for the current silence episode. */
  stallEmitted: boolean;
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
  /** Override for tests — default writes a Pi session jsonl without spawning a worker. */
  allocateSession?: AllocateSession;
  idleDestroyMs?: number;
  onWorkerMessage?: (sessionId: string, msg: WorkerOutbound) => void;
  onSessionWorkerGone?: (sessionId: string) => void;
  /** When true, skip idle worker destroy so Running-panel processes keep their worker. */
  hasActiveRuns?: (sessionId: string) => boolean;
}): SessionBroker {
  const idleDestroyMs = deps.idleDestroyMs ?? IDLE_WORKER_DESTROY_MS;
  const allocateSession = deps.allocateSession ?? (async (cwd: string) => allocateSessionOnDisk(cwd));
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
    // Defer destroy while Running-panel still tracks bash (incl. background survivors).
    if (deps.hasActiveRuns?.(sessionId)) {
      scheduleIdleDestroy(sessionId);
      return;
    }
    stopHeartbeat(rec);
    clearIdleDestroyTimer(rec);
    rec.worker.kill();
    rec.worker = null;
    deps.onSessionWorkerGone?.(sessionId);
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
    rec.lastAliveAt = Date.now();
    rec.stallEmitted = false;
    rec.heartbeatTimer = setInterval(() => {
      const current = sessions.get(sessionId);
      if (!current?.worker) {
        return;
      }
      // Never declare stuck while a turn is in flight — silence is normal
      // (thinking / TTFT / long tools / event-loop busy). Real deaths come via
      // exit/fatal; Stop uses abort; renderer soft-hang handles alive-but-silent.
      if (hasActiveTurn(current)) {
        // Total event-loop silence (no pong, no events) past the stall window
        // means the loop is wedged, not slow. Emit once — the renderer decides
        // whether to abort + restart; we never kill a mid-turn worker here.
        if (Date.now() - current.lastAliveAt >= STALL_EMIT_MS && !current.stallEmitted) {
          current.stallEmitted = true;
          emit({ type: "worker_stall", sessionId });
        }
        void current.worker.send({ kind: "ping" });
        return;
      }
      // Idle only: mark stuck when silent for the full miss window.
      // Using lastAliveAt (not a miss counter) avoids false positives when the main
      // process was blocked and several setInterval callbacks queue up at once.
      const silentMs = Date.now() - current.lastAliveAt;
      if (silentMs >= HEARTBEAT_INTERVAL_MS * HEARTBEAT_MISS_LIMIT_IDLE) {
        if (current.summary.status !== "stuck") {
          setStatus(sessionId, "stuck");
          emit({ type: "worker_stuck", sessionId });
        }
        // Drop the hung worker handle. Leaving it alive makes stop/send hang forever
        // on postMessage to a non-responsive utilityProcess.
        if (current.worker) {
          clearIdleDestroyTimer(current);
          stopHeartbeat(current);
          rejectPendingCommands(current, "worker unresponsive");
          try {
            current.worker.kill();
          } catch {
            // ignore
          }
          current.worker = null;
          current.workerPromise = null;
          deps.onSessionWorkerGone?.(sessionId);
        }
      }
      if (current.worker) {
        void current.worker.send({ kind: "ping" });
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  function hasActiveTurn(rec: SessionRecord): boolean {
    if (rec.summary.status === "running") return true;
    for (const pending of rec.pendingCommands.values()) {
      const t = pending.command.type;
      if (
        t === "prompt" ||
        t === "steer" ||
        t === "follow_up" ||
        t === "hang" ||
        t === "compact" ||
        t === "abort"
      ) {
        return true;
      }
    }
    return false;
  }

  function noteWorkerAlive(rec: SessionRecord): void {
    rec.lastAliveAt = Date.now();
    rec.stallEmitted = false;
  }

  function recoverFromStuck(sessionId: string, rec: SessionRecord): void {
    if (rec.summary.status !== "stuck") return;
    const hasPendingPrompt = [...rec.pendingCommands.values()].some(
      (p) => p.command.type === "prompt",
    );
    setStatus(sessionId, hasPendingPrompt ? "running" : "idle");
    if (!hasPendingPrompt) {
      scheduleIdleDestroy(sessionId);
    }
  }

  async function spawnWorkerForRecord(
    sessionId: string,
    rec: SessionRecord,
  ): Promise<void> {
    if (rec.worker) {
      return;
    }
    // Dedupe: prewarm and a first-command cold start may race on the same session.
    if (rec.workerPromise) {
      await rec.workerPromise;
      return;
    }
    const promise = doSpawnWorker(sessionId, rec);
    rec.workerPromise = promise;
    try {
      await promise;
    } finally {
      if (rec.workerPromise === promise) {
        rec.workerPromise = null;
      }
    }
  }

  async function doSpawnWorker(
    sessionId: string,
    rec: SessionRecord,
  ): Promise<void> {
    const filePath = rec.summary.filePath || undefined;
    const spawned = await deps.spawnWorker(rec.cwd, filePath);
    if (spawned.id !== sessionId) {
      spawned.worker.kill();
      throw new Error(
        `session id mismatch: expected ${sessionId}, got ${spawned.id}` +
          (filePath ? ` (file: ${filePath})` : " (new session had no file yet)"),
      );
    }
    rec.worker = spawned.worker;
    rec.spawnedAt = Date.now();
    rec.summary.filePath = spawned.filePath;
    attachWorker(sessionId, spawned.worker);
    startHeartbeat(sessionId);
    scheduleIdleDestroy(sessionId);
    emit({ type: "connected", sessionId });
  }

  /**
   * Start the Pi agent worker in the background so the first prompt after
   * switching to a session is fast (no cold-start stall on send).
   */
  /**
   * Destroy the oldest idle workers once more than MAX_IDLE_WORKERS are alive,
   * so prewarming many sessions cannot balloon the process count.
   */
  function trimIdleWorkers(): void {
    const idle: { sessionId: string; spawnedAt: number }[] = [];
    for (const [id, rec] of sessions) {
      if (!rec.worker || rec.summary.status !== "idle" || rec.workerPromise) continue;
      if (deps.hasActiveRuns?.(id)) continue;
      idle.push({ sessionId: id, spawnedAt: rec.spawnedAt });
    }
    const excess = idle.length - MAX_IDLE_WORKERS;
    if (excess <= 0) return;
    idle.sort((a, b) => a.spawnedAt - b.spawnedAt);
    for (let i = 0; i < excess; i++) {
      const target = idle[i]!;
      const rec = sessions.get(target.sessionId);
      if (rec?.worker && rec.summary.status === "idle" && !rec.workerPromise) {
        stopHeartbeat(rec);
        clearIdleDestroyTimer(rec);
        rec.worker.kill();
        rec.worker = null;
        rec.workerPromise = null;
        deps.onSessionWorkerGone?.(target.sessionId);
      }
    }
  }

  function prewarmWorker(sessionId: string): void {
    trimIdleWorkers();
    const rec = sessions.get(sessionId);
    if (!rec || rec.worker || rec.workerPromise) {
      return;
    }
    void spawnWorkerForRecord(sessionId, rec).catch((err) => {
      console.warn(
        `[session-broker] worker prewarm failed for session ${sessionId}:`,
        err instanceof Error ? err.message : err,
      );
    });
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

      // Any inbound message proves the utilityProcess event loop is alive.
      noteWorkerAlive(rec);
      deps.onWorkerMessage?.(sessionId, msg);

      if (msg.kind === "pong") {
        recoverFromStuck(sessionId, rec);
        // During long turns, surface heartbeat so UI can distinguish "waiting on model"
        // from a wedged idle worker (active turns are never auto-killed by silence).
        if (hasActiveTurn(rec)) {
          emit({ type: "worker_alive", sessionId });
        }
        return;
      }

      if (msg.kind === "event" && msg.event) {
        recoverFromStuck(sessionId, rec);
        const ev = msg.event as {
          type?: unknown;
          tokens?: unknown;
          contextWindow?: unknown;
          percent?: unknown;
          toolCalls?: unknown;
          messageCount?: unknown;
          segments?: unknown;
          willRetry?: unknown;
        };
        if (ev.type === "context_usage" && typeof ev.contextWindow === "number") {
          const segments = Array.isArray(ev.segments)
            ? ev.segments
                .map((row): ContextUsageSegment | null => {
                  if (!row || typeof row !== "object") return null;
                  const s = row as { id?: unknown; tokens?: unknown };
                  if (
                    typeof s.id !== "string" ||
                    !CONTEXT_SEGMENT_IDS.has(s.id as ContextUsageSegmentId)
                  ) {
                    return null;
                  }
                  if (typeof s.tokens !== "number" || s.tokens <= 0) return null;
                  return { id: s.id as ContextUsageSegmentId, tokens: s.tokens };
                })
                .filter((s): s is ContextUsageSegment => Boolean(s))
            : null;
          emit({
            type: "context_usage",
            sessionId,
            usage: {
              tokens: typeof ev.tokens === "number" ? ev.tokens : null,
              contextWindow: ev.contextWindow,
              percent: typeof ev.percent === "number" ? ev.percent : null,
              toolCalls: typeof ev.toolCalls === "number" ? ev.toolCalls : null,
              messageCount: typeof ev.messageCount === "number" ? ev.messageCount : null,
              segments,
            },
          });
          return;
        }
        emit({ type: "agent_event", sessionId, event: msg.event });
        // Keep broker status aligned with agent lifecycle (not only prompt IPC result).
        // Do not mark idle while a prompt command is still awaiting session.prompt() —
        // agent_end/settled can fire before that promise resolves; draining a new prompt
        // then hits "Agent is already processing".
        const hasPendingPrompt = [...rec.pendingCommands.values()].some(
          (p) => p.command.type === "prompt",
        );
        if (ev.type === "agent_start" || ev.type === "turn_start") {
          setStatus(sessionId, "running");
        } else if (ev.type === "agent_end" && !ev.willRetry) {
          if (!hasPendingPrompt) setStatus(sessionId, "idle");
        } else if (ev.type === "agent_settled") {
          if (!hasPendingPrompt) {
            setStatus(sessionId, "idle");
            scheduleIdleDestroy(sessionId);
          }
        }
        return;
      }

      if (msg.kind === "fatal") {
        // Idle-destroy / clean process exit must not spam the chat as an error.
        const errText = msg.error ?? "worker fatal";
        clearIdleDestroyTimer(rec);
        stopHeartbeat(rec);
        rec.worker = null;
        rec.workerPromise = null;
        if (/^worker exited \(0\)$/i.test(errText.trim())) {
          deps.onSessionWorkerGone?.(sessionId);
          if (rec.summary.status === "running" || rec.summary.status === "stuck") {
            setStatus(sessionId, "idle");
          }
          return;
        }
        rejectPendingCommands(rec, errText);
        setStatus(sessionId, "error");
        deps.onSessionWorkerGone?.(sessionId);
        emit({
          type: "prompt_error",
          sessionId,
          errorMessage: errText,
        });
        return;
      }

      if (msg.kind === "result" && msg.id) {
        recoverFromStuck(sessionId, rec);
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

  function registerSessionShell(
    id: string,
    cwd: string,
    filePath: string,
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
    const existing = sessions.get(id);
    if (existing) {
      existing.cwd = cwd;
      existing.summary = {
        ...existing.summary,
        ...summary,
        status: existing.worker ? existing.summary.status : "idle",
      };
      return { ...existing.summary };
    }
    sessions.set(id, {
      cwd,
      summary,
      worker: null,
      workerPromise: null,
      spawnedAt: 0,
      lastAliveAt: Date.now(),
      heartbeatTimer: null,
      idleDestroyTimer: null,
      stallEmitted: false,
      pendingCommands: new Map(),
    });
    return { ...summary };
  }

  function registerWorkerSession(
    id: string,
    cwd: string,
    filePath: string,
    worker: WorkerHandle,
    meta?: Partial<Pick<SessionSummary, "name" | "firstMessage" | "modified">>,
  ): SessionSummary {
    const summary = registerSessionShell(id, cwd, filePath, meta);
    const rec = sessions.get(id);
    if (!rec) return summary;
    rec.worker = worker;
    rec.summary.filePath = filePath;
    rec.lastAliveAt = Date.now();
    attachWorker(id, worker);
    startHeartbeat(id);
    scheduleIdleDestroy(id);
    emit({ type: "connected", sessionId: id });
    return { ...rec.summary };
  }

  async function createSession(cwd: string): Promise<SessionSummary> {
    // Fast path: disk session only. Pi agent worker starts on first send/command.
    const allocated = await allocateSession(cwd);
    return registerSessionShell(allocated.id, allocated.cwd, allocated.filePath);
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

  function deleteCachedImage(sessionId: string, cachePath: string): void {
    const rec = sessions.get(sessionId);
    const filePath = rec?.summary.filePath;
    if (!filePath || !cachePath) return;
    deleteImageFile(filePath, cachePath);
  }


  async function cacheImage(
    sessionId: string,
    source: SessionImageCacheSource,
  ): Promise<SessionImageCacheResult> {
    const rec = sessions.get(sessionId);
    const filePath = rec?.summary.filePath;
    if (!filePath) throw new Error(`session not found: ${sessionId}`);
    if ("url" in source && typeof source.url === "string" && source.url.trim()) {
      const saved = await downloadImageToCache(filePath, source.url.trim());
      return { filePath: saved.filePath, mimeType: saved.mimeType, dataUrl: saved.dataUrl };
    }
    if ("dataUrl" in source && typeof source.dataUrl === "string" && source.dataUrl.trim()) {
      const saved = saveImageDataUrl(filePath, source.dataUrl.trim());
      return {
        filePath: saved.filePath,
        mimeType: saved.mimeType,
        dataUrl: source.dataUrl.trim(),
      };
    }
    throw new Error("cacheImage: no image source provided");
  }

  function persistUserMessageMeta(
    sessionId: string,
    text: string,
    tags: ChatMessageTag[],
  ): void {
    const rec = sessions.get(sessionId);
    const filePath = rec?.summary.filePath;
    if (!filePath || !text || !tags.length) return;
    appendChatMeta(filePath, text, tags);
    // Tags were written after the jsonl message append — drop the history
    // cache so the next reload picks them up immediately.
    invalidateSessionHistoryCache(filePath);
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
    if (live) {
      // Re-sync title/first message from disk — do NOT spawn the agent worker here.
      const disk = await listSessionsForCwd(cwd);
      const target = disk.find((s) => s.id === sessionId);
      if (target) {
        if (target.name?.trim()) live.summary.name = target.name;
        if (target.firstMessage?.trim()) live.summary.firstMessage = target.firstMessage;
        live.summary.modified = target.modified;
        if (target.filePath) live.summary.filePath = target.filePath;
      }
      // Warm the Pi agent worker in the background so first send is snappy.
      prewarmWorker(sessionId);
      return { ...live.summary };
    }
    const disk = await listSessionsForCwd(cwd);
    const target = disk.find((s) => s.id === sessionId);
    if (!target?.filePath) {
      return null;
    }
    if (!existsSync(target.filePath)) {
      throw new Error(
        `session file missing (cannot open): ${target.filePath}. Create a new session or restore the file.`,
      );
    }
    // Register shell, then warm the Pi agent worker in the background so the
    // first prompt after switching is fast (no cold-start stall on send).
    const summary = registerSessionShell(target.id, cwd, target.filePath, {
      name: target.name,
      firstMessage: target.firstMessage,
      modified: target.modified,
    });
    prewarmWorker(summary.id);
    return summary;
  }

  async function disconnectWorker(sessionId: string, reason: string): Promise<void> {
    const rec = sessions.get(sessionId);
    if (!rec?.worker) {
      if (rec) {
        clearIdleDestroyTimer(rec);
        stopHeartbeat(rec);
      }
      return;
    }
    clearIdleDestroyTimer(rec);
    stopHeartbeat(rec);
    rejectPendingCommands(rec, reason);
    const worker = rec.worker;
    rec.worker = null;
    rec.workerPromise = null;
    try {
      await Promise.race([
        worker.send({ kind: "shutdown" }),
        new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS)),
      ]);
    } catch {
      // ignore — force kill below
    }
    try {
      worker.kill();
    } catch {
      // ignore
    }
    deps.onSessionWorkerGone?.(sessionId);
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
    await disconnectWorker(sessionId, "session closed");
    sessions.delete(sessionId);
    emit({ type: "worker_exit", sessionId, code: 0 });
  }

  async function sendRaw(
    sessionId: string,
    msg: WorkerInbound,
  ): Promise<WorkerOutbound | null> {
    const rec = await ensureWorker(sessionId);
    const worker = rec.worker;
    if (!worker) {
      throw new Error(`session worker unavailable: ${sessionId}`);
    }
    return worker.send(msg);
  }

  async function sendRawIfAlive(
    sessionId: string,
    msg: WorkerInbound,
  ): Promise<boolean> {
    const rec = sessions.get(sessionId);
    const worker = rec?.worker;
    if (!worker) {
      return false;
    }
    await worker.send(msg);
    return true;
  }

  async function send(
    sessionId: string,
    command: AgentCommand,
    opts?: { coldStart?: boolean },
  ): Promise<unknown | undefined> {
    const coldStart = opts?.coldStart !== false;
    const rec = coldStart ? await ensureWorker(sessionId) : sessions.get(sessionId);
    const worker = rec?.worker;
    if (!worker) {
      if (!coldStart) return undefined;
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
      let forceTimer: ReturnType<typeof setTimeout> | null = null;
      const clearForce = (): void => {
        if (forceTimer) {
          clearTimeout(forceTimer);
          forceTimer = null;
        }
      };
      rec!.pendingCommands.set(cmdId, {
        command,
        resolve: (v) => {
          clearForce();
          resolve(v);
        },
        reject: (e) => {
          clearForce();
          reject(e);
        },
      });
      if (command.type === "abort") {
        forceTimer = setTimeout(() => {
          const pending = rec!.pendingCommands.get(cmdId);
          if (!pending) return;
          rec!.pendingCommands.delete(cmdId);
          clearIdleDestroyTimer(rec!);
          stopHeartbeat(rec!);
          rejectPendingCommands(rec!, "abort timed out — worker killed");
          if (rec!.worker) {
            try {
              rec!.worker.kill();
            } catch {
              // ignore
            }
            rec!.worker = null;
          }
          deps.onSessionWorkerGone?.(sessionId);
          setStatus(sessionId, "idle");
          resolve({ ok: true, forced: true });
        }, ABORT_FORCE_KILL_MS);
      }
      void worker.send(outbound).then((direct) => {
        if (direct?.kind === "result") {
          const pending = rec!.pendingCommands.get(cmdId);
          if (!pending) {
            return;
          }
          rec!.pendingCommands.delete(cmdId);
          clearForce();
          if (direct.error) {
            reject(new Error(direct.error));
          } else {
            resolve(direct.data);
          }
        }
      });
    });
  }

  async function trySend(
    sessionId: string,
    command: AgentCommand,
  ): Promise<unknown | undefined> {
    return send(sessionId, command, { coldStart: false });
  }

  async function killWorker(sessionId: string): Promise<void> {
    const rec = sessions.get(sessionId);
    if (!rec) {
      return;
    }
    await disconnectWorker(sessionId, "worker terminated");
    setStatus(sessionId, "error");
    emit({ type: "worker_exit", sessionId, code: null });
  }

  async function restartWorker(sessionId: string): Promise<void> {
    const rec = sessions.get(sessionId);
    if (!rec) {
      return;
    }
    await disconnectWorker(sessionId, "worker restarted");
    await spawnWorkerForRecord(sessionId, rec);
    setStatus(sessionId, "idle");
  }

  async function restartWorkersForCwd(cwd: string): Promise<void> {
    const resolved = path.resolve(cwd);
    const ids = [...sessions.entries()]
      .filter(([, rec]) => path.resolve(rec.cwd) === resolved && rec.worker !== null)
      .map(([id]) => id);
    for (const id of ids) {
      await restartWorker(id);
    }
  }

  async function deleteSession(sessionId: string, cwd: string): Promise<void> {
    const rec = sessions.get(sessionId);
    let filePath = rec?.summary.filePath;
    if (!filePath) {
      const disk = await listSessionsForCwd(cwd);
      filePath = disk.find((s) => s.id === sessionId)?.filePath;
    }
    // Disconnect agent first, then remove registry + disk record.
    await disconnectWorker(sessionId, "session deleted");
    sessions.delete(sessionId);
    if (filePath) {
      try {
        await deleteSessionFile(filePath);
      } catch {
        // file may already be gone
      }
    }
  }

  async function clearContext(sessionId: string, cwd: string): Promise<void> {
    const live = sessions.get(sessionId);
    const disk = await listSessionsForCwd(cwd);
    const target = disk.find((s) => s.id === sessionId);
    const filePath = (live?.summary.filePath || target?.filePath || "").trim();
    if (!filePath) {
      throw new Error("session file not found");
    }

    // Stop the live worker first so it cannot append while we rewrite the file.
    await disconnectWorker(sessionId, "context cleared");

    await clearSessionConversation(filePath);

    if (live) {
      live.summary.firstMessage = undefined;
      live.summary.modified = new Date().toISOString();
      setStatus(sessionId, "idle");
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

  async function notifyWorkersReloadSecurity(
    desktopSecurity: DesktopSecuritySettings,
  ): Promise<void> {
    const ids = [...sessions.entries()]
      .filter(([, rec]) => rec.worker !== null)
      .map(([id]) => id);
    for (const id of ids) {
      await sendRawIfAlive(id, { kind: "reload_security", desktopSecurity });
    }
  }

  return {
    createSession,
    listSessions,
    openSession,
    closeSession,
    send,
    trySend,
    sendRaw,
    sendRawIfAlive,
    killWorker,
    restartWorker,
    restartWorkersForCwd,
    deleteSession,
    clearContext,
    notifyWorkersReloadModels,
    notifyWorkersReloadSecurity,
    patchSummary,
    persistUserMessageMeta,
    cacheImage,
    deleteCachedImage,
    onEvent,
  };
}

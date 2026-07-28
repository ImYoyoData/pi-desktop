import { defineStore } from "pinia";
import { computed, onScopeDispose, ref } from "vue";
import type {
  AgentCommand,
  AgentEvent,
  ContextUsageSegment,
  ContextUsageSegmentId,
  SessionContextUsage,
  SessionSummary,
} from "../../../shared/protocol";
import { toIpcPlain } from "../../../shared/protocol";
import { useComposerStore } from "./composer";

const SEGMENT_IDS = new Set<ContextUsageSegmentId>([
  "system",
  "tools",
  "summarized",
  "conversation",
  "toolResults",
]);

function parseContextUsage(data: unknown): SessionContextUsage | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as { contextUsage?: unknown };
  const usage = raw.contextUsage ?? data;
  if (!usage || typeof usage !== "object") return null;
  const u = usage as {
    tokens?: unknown;
    contextWindow?: unknown;
    percent?: unknown;
    toolCalls?: unknown;
    messageCount?: unknown;
    segments?: unknown;
  };
  if (typeof u.contextWindow !== "number" || u.contextWindow <= 0) return null;
  const segments = Array.isArray(u.segments)
    ? u.segments
        .map((row): ContextUsageSegment | null => {
          if (!row || typeof row !== "object") return null;
          const s = row as { id?: unknown; tokens?: unknown };
          if (typeof s.id !== "string" || !SEGMENT_IDS.has(s.id as ContextUsageSegmentId)) {
            return null;
          }
          if (typeof s.tokens !== "number" || s.tokens <= 0) return null;
          return { id: s.id as ContextUsageSegmentId, tokens: s.tokens };
        })
        .filter((s): s is ContextUsageSegment => Boolean(s))
    : null;
  return {
    tokens: typeof u.tokens === "number" ? u.tokens : null,
    contextWindow: u.contextWindow,
    percent: typeof u.percent === "number" ? u.percent : null,
    toolCalls: typeof u.toolCalls === "number" ? u.toolCalls : null,
    messageCount: typeof u.messageCount === "number" ? u.messageCount : null,
    segments,
  };
}

export const useSessionsStore = defineStore("sessions", () => {
  const sessions = ref<SessionSummary[]>([]);
  const activeId = ref<string | null>(null);
  const contextBySession = ref<Record<string, SessionContextUsage>>({});

  const activeContextUsage = computed(() => {
    const id = activeId.value;
    if (!id) return null;
    return contextBySession.value[id] ?? null;
  });

  function upsert(summary: SessionSummary): void {
    const idx = sessions.value.findIndex((s) => s.id === summary.id);
    if (idx >= 0) {
      // Replace array so sidebar/header title computeds refresh reliably (#3).
      sessions.value = sessions.value.map((s, i) => (i === idx ? { ...summary } : s));
    } else {
      sessions.value = [...sessions.value, summary];
    }
  }

  function patchStatus(sessionId: string, status: SessionSummary["status"]): void {
    const idx = sessions.value.findIndex((s) => s.id === sessionId);
    if (idx < 0) return;
    const row = sessions.value[idx];
    if (row.status === status) return;
    // Replace row so list watchers / computed status update reliably.
    sessions.value = sessions.value.map((s, i) => (i === idx ? { ...s, status } : s));
  }

  function setContextUsage(sessionId: string, usage: SessionContextUsage): void {
    contextBySession.value = { ...contextBySession.value, [sessionId]: usage };
  }

  function applyContextFromState(sessionId: string, data: unknown): void {
    const usage = parseContextUsage(data);
    if (usage) setContextUsage(sessionId, usage);
  }

  function applyEvent(event: AgentEvent): void {
    switch (event.type) {
      case "connected":
        break;
      case "agent_event": {
        // Only start/end should drive sidebar status — not every stream chunk
        const payload = event.event as {
          type?: unknown;
          willRetry?: unknown;
          success?: unknown;
          message?: { stopReason?: unknown };
        };
        const t = payload?.type;
        const willRetry = Boolean(payload?.willRetry);
        if (t === "agent_start" || t === "turn_start") {
          patchStatus(event.sessionId, "running");
        } else if (t === "agent_end" && !willRetry) {
          patchStatus(event.sessionId, "idle");
        } else if (t === "agent_settled") {
          patchStatus(event.sessionId, "idle");
        } else if (t === "message_end") {
          const stop = payload?.message?.stopReason;
          if (stop === "error" || stop === "aborted") {
            patchStatus(event.sessionId, "idle");
          }
        } else if (t === "auto_retry_end" && payload?.success === false) {
          patchStatus(event.sessionId, "idle");
        }
        break;
      }
      case "context_usage":
        setContextUsage(event.sessionId, event.usage);
        break;
      case "prompt_done":
        patchStatus(event.sessionId, "idle");
        break;
      case "prompt_error":
        // SDK / prompt failures stop the turn — leave idle, not stuck "running".
        patchStatus(event.sessionId, "idle");
        break;
      case "worker_stuck":
        patchStatus(event.sessionId, "stuck");
        break;
      case "session_status":
        patchStatus(event.sessionId, event.status);
        break;
      case "worker_exit":
        // code 0 / null = clean idle-destroy or session close — stay idle, not error
        patchStatus(
          event.sessionId,
          event.code === 0 || event.code == null ? "idle" : "error",
        );
        break;
      default: {
        const _never: never = event;
        void _never;
      }
    }
  }

  async function refresh(cwd: string | null): Promise<void> {
    if (!cwd) {
      sessions.value = [];
      return;
    }
    sessions.value = await window.api.sessions.list(cwd);
  }

  async function createSession(cwd: string): Promise<SessionSummary | null> {
    const created = await window.api.sessions.create(cwd);
    upsert(created);
    activeId.value = created.id;
    return created;
  }

  async function selectSession(sessionId: string, cwd: string): Promise<void> {
    // Open/register in the broker BEFORE flipping activeId.
    // Otherwise Composer watches activeId and races sessions:command → unknown session.
    const opened = await window.api.sessions.open(sessionId, cwd);
    if (!opened) {
      throw new Error(`failed to open session: ${sessionId}`);
    }
    upsert(opened);
    activeId.value = sessionId;
  }

  async function sendCommand(sessionId: string, command: AgentCommand): Promise<unknown> {
    // Vue/Pinia proxies are not structured-cloneable → "An object could not be cloned".
    const plain = toIpcPlain(command);
    if (plain.type === "prompt" || plain.type === "hang") {
      patchStatus(sessionId, "running");
    }
    try {
      return await window.api.sessions.command(sessionId, plain);
    } catch (err) {
      if (plain.type === "prompt" || plain.type === "hang") {
        patchStatus(sessionId, "idle");
      }
      throw err;
    }
  }

  async function killWorker(sessionId: string, cwd: string | null): Promise<void> {
    await window.api.sessions.killWorker(sessionId);
    await refresh(cwd);
  }

  async function restartWorker(sessionId: string, cwd: string | null): Promise<void> {
    await window.api.sessions.restartWorker(sessionId);
    await refresh(cwd);
  }

  async function deleteSession(sessionId: string, cwd: string): Promise<void> {
    await window.api.sessions.delete(sessionId, cwd);
    if (activeId.value === sessionId) {
      activeId.value = null;
    }
    sessions.value = sessions.value.filter((s) => s.id !== sessionId);
    const next = { ...contextBySession.value };
    delete next[sessionId];
    contextBySession.value = next;
    useComposerStore().dropSession(sessionId);
  }

  async function renameSession(sessionId: string, cwd: string, name: string): Promise<SessionSummary | null> {
    const trimmed = name.trim();
    // Optimistic UI update so title flips immediately (before IPC round-trip).
    if (trimmed) {
      const idx = sessions.value.findIndex((s) => s.id === sessionId);
      if (idx >= 0) {
        const row = sessions.value[idx]!;
        sessions.value = sessions.value.map((s, i) =>
          i === idx ? { ...row, name: trimmed, modified: new Date().toISOString() } : s,
        );
      }
    }
    const updated = await window.api.sessions.rename(sessionId, cwd, trimmed);
    if (updated) upsert({ ...updated, name: updated.name?.trim() || trimmed });
    return updated;
  }

  let eventsBound = false;
  function bindEvents(): void {
    if (eventsBound) return;
    eventsBound = true;
    const off = window.api.sessions.onEvent((event) => {
      applyEvent(event);
    });
    onScopeDispose(() => {
      eventsBound = false;
      off();
    });
  }

  return {
    sessions,
    activeId,
    contextBySession,
    activeContextUsage,
    applyContextFromState,
    refresh,
    createSession,
    selectSession,
    sendCommand,
    killWorker,
    restartWorker,
    deleteSession,
    renameSession,
    bindEvents,
  };
});

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
import { isUnstartedSession } from "@renderer/utils/session-started";
import { useComposerStore } from "./composer";

/** 工作区路径比较（分隔符与大小写无关）。 */
function sameWorkspacePath(a: string, b: string): boolean {
  const norm = (p: string) =>
    p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

const SEGMENT_IDS = new Set<ContextUsageSegmentId>([
  "system",
  "tools",
  "summarized",
  "conversation",
  "toolResults",
]);

function parseContextUsage(data: unknown): SessionContextUsage | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as {
    contextUsage?: unknown;
    model?: unknown;
    thinkingLevel?: unknown;
  };
  const usage = raw.contextUsage ?? data;
  if (!usage || typeof usage !== "object") return null;
  const u = usage as {
    tokens?: unknown;
    contextWindow?: unknown;
    percent?: unknown;
    model?: unknown;
    thinkingLevel?: unknown;
    toolCalls?: unknown;
    messageCount?: unknown;
    turns?: unknown;
    steps?: unknown;
    inputTokens?: unknown;
    outputTokens?: unknown;
    cacheReadTokens?: unknown;
    cacheWriteTokens?: unknown;
    costUsd?: unknown;
    llmDurationMs?: unknown;
    ttftMs?: unknown;
    ttftSteps?: unknown;
    tokensPerSecond?: unknown;
    segments?: unknown;
  };
  if (typeof u.contextWindow !== "number" || u.contextWindow <= 0) return null;
  const segments = Array.isArray(u.segments)
    ? u.segments
        .map((row): ContextUsageSegment | null => {
          if (!row || typeof row !== "object") return null;
          const s = row as { id?: unknown; tokens?: unknown };
          if (
            typeof s.id !== "string" ||
            !SEGMENT_IDS.has(s.id as ContextUsageSegmentId)
          ) {
            return null;
          }
          if (typeof s.tokens !== "number" || s.tokens <= 0) return null;
          return { id: s.id as ContextUsageSegmentId, tokens: s.tokens };
        })
        .filter((s): s is ContextUsageSegment => Boolean(s))
    : null;
  // get_state 把两者放在 contextUsage 同级，usage 事件则放在其内部。
  const model = (u.model ?? raw.model) as
    | { provider?: unknown; id?: unknown }
    | null
    | undefined;
  const thinkingLevel = u.thinkingLevel ?? raw.thinkingLevel;
  return {
    tokens: typeof u.tokens === "number" ? u.tokens : null,
    contextWindow: u.contextWindow,
    percent: typeof u.percent === "number" ? u.percent : null,
    model:
      model && typeof model.provider === "string" && typeof model.id === "string"
        ? { provider: model.provider, id: model.id }
        : null,
    thinkingLevel: typeof thinkingLevel === "string" ? thinkingLevel : null,
    toolCalls: typeof u.toolCalls === "number" ? u.toolCalls : null,
    messageCount: typeof u.messageCount === "number" ? u.messageCount : null,
    turns: typeof u.turns === "number" ? u.turns : null,
    steps: typeof u.steps === "number" ? u.steps : null,
    inputTokens: typeof u.inputTokens === "number" ? u.inputTokens : null,
    outputTokens: typeof u.outputTokens === "number" ? u.outputTokens : null,
    cacheReadTokens:
      typeof u.cacheReadTokens === "number" ? u.cacheReadTokens : null,
    cacheWriteTokens:
      typeof u.cacheWriteTokens === "number" ? u.cacheWriteTokens : null,
    costUsd: typeof u.costUsd === "number" ? u.costUsd : null,
    llmDurationMs: typeof u.llmDurationMs === "number" ? u.llmDurationMs : null,
    ttftMs: typeof u.ttftMs === "number" ? u.ttftMs : null,
    ttftSteps: typeof u.ttftSteps === "number" ? u.ttftSteps : null,
    tokensPerSecond:
      typeof u.tokensPerSecond === "number" ? u.tokensPerSecond : null,
    segments,
  };
}

export const useSessionsStore = defineStore("sessions", () => {
  const sessions = ref<SessionSummary[]>([]);
  /** cwd 当前 sessions 列表所属的工作区（null=未加载/已清空）。 */
  const listRoot = ref<string | null>(null);
  const activeId = ref<string | null>(null);
  /** 未创建的新会话草稿所属工作区（null=不处于草稿态）。 */
  const draftRoot = ref<string | null>(null);
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
      sessions.value = sessions.value.map((s, i) =>
        i === idx ? { ...summary } : s,
      );
    } else {
      sessions.value = [...sessions.value, summary];
    }
  }

  function patchStatus(
    sessionId: string,
    status: SessionSummary["status"],
  ): void {
    const idx = sessions.value.findIndex((s) => s.id === sessionId);
    if (idx < 0) return;
    const row = sessions.value[idx];
    if (row.status === status) return;
    // Replace row so list watchers / computed status update reliably.
    sessions.value = sessions.value.map((s, i) =>
      i === idx ? { ...s, status } : s,
    );
  }

  function setContextUsage(
    sessionId: string,
    usage: SessionContextUsage,
  ): void {
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
      case "worker_stall":
        // Turn still counts as running — the renderer watchdog restarts + resends.
        break;
      case "worker_alive":
        // Soft liveness for the chat wait indicator — status stays running/idle.
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
      listRoot.value = null;
      draftRoot.value = null;
      return;
    }
    if (draftRoot.value && draftRoot.value !== cwd) draftRoot.value = null;
    // 预热草稿与崩溃残留的空会话不上侧栏；活动会话始终保留。
    const rows = await window.api.sessions.list(cwd);
    sessions.value = rows.filter(
      (row) => row.id === activeId.value || !isUnstartedSession(row),
    );
    listRoot.value = cwd;
  }

  /** Drop in-memory state for a session that was deleted (shared cleanup). */
  function dropSessionState(sessionId: string): void {
    if (activeId.value === sessionId) {
      activeId.value = null;
    }
    sessions.value = sessions.value.filter((s) => s.id !== sessionId);
    const next = { ...contextBySession.value };
    delete next[sessionId];
    contextBySession.value = next;
    useComposerStore().dropSession(sessionId);
  }

  /** Active row when it was never used (no messages, no name) — safe to discard. */
  function activeIfUnstarted(): SessionSummary | null {
    const id = activeId.value;
    if (!id) return null;
    const row = sessions.value.find((s) => s.id === id) ?? null;
    return row && isUnstartedSession(row) ? row : null;
  }

  /** 草稿预热会话：已落盘并预热 worker，但尚未进入侧栏。 */
  let preparedDraft: { cwd: string; summary: SessionSummary } | null = null;

  /** 释放未使用的预热会话；已被认领时不动。 */
  async function releasePreparedDraft(): Promise<void> {
    const pending = preparedDraft;
    preparedDraft = null;
    if (!pending || activeId.value === pending.summary.id) return;
    try {
      await window.api.sessions.delete(pending.summary.id, pending.summary.cwd);
    } catch {
      // 未使用的空会话不上侧栏，残留无害
    }
  }

  /** 草稿开始输入时调用：后台建会话并预热 worker，冷启动挪到打字期间。 */
  async function prepareDraft(cwd: string): Promise<void> {
    if (!cwd) return;
    if (preparedDraft && sameWorkspacePath(preparedDraft.cwd, cwd)) return;
    await releasePreparedDraft();
    try {
      const created = await window.api.sessions.create(cwd);
      preparedDraft = { cwd, summary: created };
    } catch {
      // 预热失败时仍走发送时建会话的老路
    }
  }

  /** 仅改变草稿归属的工作区，保留已输入的草稿内容。 */
  function setDraftRoot(cwd: string): void {
    if (preparedDraft && !sameWorkspacePath(preparedDraft.cwd, cwd)) {
      void releasePreparedDraft();
    }
    draftRoot.value = cwd;
    activeId.value = null;
    // 进入草稿即后台预热会话与 worker（点新建会话/应用启动就开跑），首条消息不再等冷启动。
    void prepareDraft(cwd);
  }

  /**
   * 打开空白的新会话输入界面但不落盘。会话文件只在首次发送消息时创建，
   * 因此被放弃的草稿既不会出现在侧栏，也不会在磁盘留下空会话。
   */
  function beginDraft(cwd: string): void {
    setDraftRoot(cwd);
    // 保留草稿缓冲：反复新建或切走再回来都不丢已输入内容（发送成功才清空）。
    useComposerStore().bindSession(null);
  }

  /** 草稿首次发送：创建会话文件并切换为活动会话（复用预热会话）。 */
  async function commitDraft(): Promise<SessionSummary | null> {
    const cwd = draftRoot.value;
    if (!cwd) return null;
    const prepared =
      preparedDraft && sameWorkspacePath(preparedDraft.cwd, cwd)
        ? preparedDraft
        : null;
    if (!prepared) await releasePreparedDraft();
    const created = prepared?.summary ?? (await window.api.sessions.create(cwd));
    preparedDraft = null;
    upsert(created);
    activeId.value = created.id;
    draftRoot.value = null;
    // 侧栏把新会话排到最前，否则它会落在折叠的旧会话之下。
    window.dispatchEvent(
      new CustomEvent("pi-session-created", {
        detail: { root: created.cwd, sessionId: created.id },
      }),
    );
    return created;
  }

  async function selectSession(sessionId: string, cwd: string): Promise<void> {
    // 切到历史会话即放弃草稿，顺带释放预热出来的空会话。
    await releasePreparedDraft();
    // Open/register in the broker BEFORE flipping activeId.
    // Otherwise Composer watches activeId and races sessions:command → unknown session.
    const opened = await window.api.sessions.open(sessionId, cwd);
    if (!opened) {
      throw new Error(`failed to open session: ${sessionId}`);
    }
    upsert(opened);
    draftRoot.value = null;
    activeId.value = sessionId;
  }

  /** Discard the active session on quit / session-switch when it was never used. */
  async function discardActiveIfUnstarted(): Promise<boolean> {
    const leaving = activeIfUnstarted();
    if (!leaving) return false;
    try {
      await window.api.sessions.delete(leaving.id, leaving.cwd);
    } catch (err) {
      console.error("discard unstarted session failed", err);
    }
    dropSessionState(leaving.id);
    return true;
  }

  async function sendCommand(
    sessionId: string,
    command: AgentCommand,
  ): Promise<unknown> {
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

  /** Never cold-starts the Pi agent worker — returns undefined when idle/shelled. */
  async function tryCommand(
    sessionId: string,
    command: AgentCommand,
  ): Promise<unknown | undefined> {
    const plain = toIpcPlain(command);
    return window.api.sessions.tryCommand(sessionId, plain);
  }

  async function killWorker(
    sessionId: string,
    cwd: string | null,
  ): Promise<void> {
    await window.api.sessions.killWorker(sessionId);
    await refresh(cwd);
  }

  async function restartWorker(
    sessionId: string,
    cwd: string | null,
  ): Promise<void> {
    await window.api.sessions.restartWorker(sessionId);
    await refresh(cwd);
  }

  async function deleteSession(sessionId: string, cwd: string): Promise<void> {
    await window.api.sessions.delete(sessionId, cwd);
    dropSessionState(sessionId);
  }

  async function renameSession(
    sessionId: string,
    cwd: string,
    name: string,
  ): Promise<SessionSummary | null> {
    const trimmed = name.trim();
    // Optimistic UI update so title flips immediately (before IPC round-trip).
    if (trimmed) {
      const idx = sessions.value.findIndex((s) => s.id === sessionId);
      if (idx >= 0) {
        const row = sessions.value[idx]!;
        sessions.value = sessions.value.map((s, i) =>
          i === idx
            ? { ...row, name: trimmed, modified: new Date().toISOString() }
            : s,
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
    listRoot,
    activeId,
    draftRoot,
    contextBySession,
    activeContextUsage,
    applyContextFromState,
    refresh,
    beginDraft,
    setDraftRoot,
    commitDraft,
    selectSession,
    discardActiveIfUnstarted,
    sendCommand,
    tryCommand,
    killWorker,
    restartWorker,
    deleteSession,
    renameSession,
    bindEvents,
  };
});

import { create } from "zustand";
import type {
  AgentCommand,
  AgentEvent,
  ContextUsageSegment,
  ContextUsageSegmentId,
  SessionContextUsage,
  SessionStatus,
  SessionSummary,
} from "../../../shared/protocol";
import { toIpcPlain } from "../../../shared/protocol";
import { isUnstartedSession } from "@renderer/utils/session-started";
import { useComposerStore } from "./composer";
import { useWorkspaceStore } from "./workspace";

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

type SessionsBase = {
  sessions: SessionSummary[];
  /** cwd 当前 sessions 列表所属的工作区（null=未加载/已清空）。 */
  listRoot: string | null;
  activeId: string | null;
  /** 未创建的新会话草稿所属工作区（null=不处于草稿态）。 */
  draftRoot: string | null;
  contextBySession: Record<string, SessionContextUsage>;
  /**
   * 会话状态镜像：按 sessionId 记录主进程给出的最新状态。
   * 与工作区无关——侧栏同时展示多个工作区，状态必须跨工作区保持最新。
   */
  statusBySession: Record<string, SessionStatus>;
};

type SessionsDerived = {
  activeContextUsage: SessionContextUsage | null;
};

export type SessionsState = SessionsBase &
  SessionsDerived & {
    applyContextFromState: (sessionId: string, data: unknown) => void;
    applyStatus: (sessionId: string, status: SessionSummary["status"]) => void;
    /** 用主进程返回的列表整体替换某个工作区的会话，并同步状态镜像。 */
    replaceList: (root: string, rows: SessionSummary[]) => void;
    refresh: (cwd: string | null) => Promise<void>;
    beginDraft: (cwd: string) => void;
    setDraftRoot: (cwd: string) => void;
    commitDraft: () => Promise<SessionSummary | null>;
    selectSession: (sessionId: string, cwd: string) => Promise<void>;
    discardActiveIfUnstarted: () => Promise<boolean>;
    discardUnstartedOnQuit: () => Promise<void>;
    sendCommand: (
      sessionId: string,
      command: AgentCommand,
    ) => Promise<unknown>;
    tryCommand: (
      sessionId: string,
      command: AgentCommand,
    ) => Promise<unknown | undefined>;
    killWorker: (sessionId: string, cwd: string | null) => Promise<void>;
    restartWorker: (sessionId: string, cwd: string | null) => Promise<void>;
    deleteSession: (sessionId: string, cwd: string) => Promise<void>;
    renameSession: (
      sessionId: string,
      cwd: string,
      name: string,
    ) => Promise<SessionSummary | null>;
    bindEvents: () => () => void;
  };

function derive(base: SessionsBase): SessionsDerived {
  const id = base.activeId;
  return {
    activeContextUsage: id ? base.contextBySession[id] ?? null : null,
  };
}

export const useSessionsStore = create<SessionsState>()((set, get) => {
  const base: SessionsBase = {
    sessions: [],
    listRoot: null,
    activeId: null,
    draftRoot: null,
    contextBySession: {},
    statusBySession: {},
  };

  let unbind: (() => void) | null = null;
  /** 草稿预热会话：已落盘并预热 worker，但尚未进入侧栏。 */
  let preparedDraft: { cwd: string; summary: SessionSummary } | null = null;

  function commit(patch: Partial<SessionsBase>): void {
    set((state) => {
      const next = { ...state, ...patch };
      return { ...next, ...derive(next) };
    });
  }

  function upsert(summary: SessionSummary): void {
    const list = get().sessions;
    const idx = list.findIndex((s) => s.id === summary.id);
    const statusBySession = {
      ...get().statusBySession,
      [summary.id]: summary.status,
    };
    if (idx >= 0) {
      // Replace array so sidebar/header title computeds refresh reliably (#3).
      commit({
        sessions: list.map((s, i) => (i === idx ? { ...summary } : s)),
        statusBySession,
      });
    } else {
      commit({ sessions: [...list, summary], statusBySession });
    }
  }

  /**
   * 列表里的状态并入镜像：主进程返回的列表是状态的权威来源，
   * 覆盖镜像后，此前由事件累积的状态也会被这次读取纠正。
   */
  function mergeStatusMirror(
    rows: SessionSummary[],
  ): Record<string, SessionStatus> {
    const mirror = { ...get().statusBySession };
    for (const row of rows) mirror[row.id] = row.status;
    return mirror;
  }

  function patchStatus(
    sessionId: string,
    status: SessionSummary["status"],
  ): void {
    const list = get().sessions;
    const idx = list.findIndex((s) => s.id === sessionId);
    const mirror = get().statusBySession;
    if (idx < 0) {
      // 会话不在当前工作区的列表里（其它工作区）：状态只进镜像。
      if (mirror[sessionId] === status) return;
      commit({ statusBySession: { ...mirror, [sessionId]: status } });
      return;
    }
    const row = list[idx];
    if (row.status === status && mirror[sessionId] === status) return;
    // Replace row so list watchers / computed status update reliably.
    commit({
      statusBySession: { ...mirror, [sessionId]: status },
      sessions: list.map((s, i) => (i === idx ? { ...s, status } : s)),
    });
  }

  function patchModified(sessionId: string, modified: string): void {
    const list = get().sessions;
    const idx = list.findIndex((s) => s.id === sessionId);
    if (idx < 0 || list[idx].modified === modified) return;
    commit({
      sessions: list.map((s, i) => (i === idx ? { ...s, modified } : s)),
    });
  }

  function setContextUsage(
    sessionId: string,
    usage: SessionContextUsage,
  ): void {
    commit({
      contextBySession: { ...get().contextBySession, [sessionId]: usage },
    });
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
      case "session_activity":
        patchModified(event.sessionId, event.modified);
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

  /**
   * 用主进程返回的列表整体替换某个工作区的会话。
   * 只有当前工作区才替换 sessions；其它工作区的行由侧栏自己缓存，只同步状态镜像。
   */
  function replaceList(root: string, rows: SessionSummary[]): void {
    const statusBySession = mergeStatusMirror(rows);
    if (root !== useWorkspaceStore.getState().root) {
      commit({ statusBySession });
      return;
    }
    commit({ sessions: rows, listRoot: root, statusBySession });
  }

  async function refresh(cwd: string | null): Promise<void> {
    if (!cwd) {
      commit({ sessions: [], listRoot: null, draftRoot: null });
      return;
    }
    if (get().draftRoot && get().draftRoot !== cwd) commit({ draftRoot: null });
    // 预热草稿与崩溃残留的空会话不上侧栏；活动会话始终保留。
    const rows = await window.api.sessions.list(cwd);
    const activeId = get().activeId;
    const kept = rows.filter(
      (row) => row.id === activeId || !isUnstartedSession(row),
    );
    commit({
      sessions: kept,
      listRoot: cwd,
      statusBySession: mergeStatusMirror(kept),
    });
  }

  /** Drop in-memory state for a session that was deleted (shared cleanup). */
  function dropSessionState(sessionId: string): void {
    const state = get();
    const next = { ...state.contextBySession };
    delete next[sessionId];
    const statusBySession = { ...state.statusBySession };
    delete statusBySession[sessionId];
    commit({
      activeId: state.activeId === sessionId ? null : state.activeId,
      sessions: state.sessions.filter((s) => s.id !== sessionId),
      contextBySession: next,
      statusBySession,
    });
    useComposerStore.getState().dropSession(sessionId);
  }

  /** Active row when it was never used (no messages, no name) — safe to discard. */
  function activeIfUnstarted(): SessionSummary | null {
    const id = get().activeId;
    if (!id) return null;
    const row = get().sessions.find((s) => s.id === id) ?? null;
    return row && isUnstartedSession(row) ? row : null;
  }

  /** 释放未使用的预热会话；已被认领时不动。 */
  async function releasePreparedDraft(): Promise<void> {
    const pending = preparedDraft;
    preparedDraft = null;
    if (!pending || get().activeId === pending.summary.id) return;
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
    commit({ draftRoot: cwd, activeId: null });
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
    useComposerStore.getState().bindSession(null);
  }

  /** 草稿首次发送：创建会话文件并切换为活动会话（复用预热会话）。 */
  async function commitDraft(): Promise<SessionSummary | null> {
    const cwd = get().draftRoot;
    if (!cwd) return null;
    const prepared =
      preparedDraft && sameWorkspacePath(preparedDraft.cwd, cwd)
        ? preparedDraft
        : null;
    if (!prepared) await releasePreparedDraft();
    const created = prepared?.summary ?? (await window.api.sessions.create(cwd));
    preparedDraft = null;
    upsert(created);
    commit({ activeId: created.id, draftRoot: null });
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
    commit({ draftRoot: null, activeId: sessionId });
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

  /**
   * Quit-time cleanup for a "新会话" the user never sent anything in.
   *
   * Two shapes have to be handled:
   * - a *prepared* draft (clicked 新建会话, then quit) — `activeId` is still null,
   *   so `discardActiveIfUnstarted` alone leaves its pre-warmed session file on
   *   disk. It never appeared in the sidebar, but the empty jsonl survived.
   * - a committed-but-unstarted session (created, still no messages).
   */
  async function discardUnstartedOnQuit(): Promise<void> {
    await releasePreparedDraft();
    await discardActiveIfUnstarted();
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

  /**
   * 刷新列表所需的工作区：调用方没给就按会话自身的工作区找。
   * 找不到时返回 null——此时应跳过刷新，而不是把列表清空。
   */
  function resolveRefreshRoot(
    sessionId: string,
    cwd: string | null,
  ): string | null {
    if (cwd) return cwd;
    const row = get().sessions.find((s) => s.id === sessionId);
    return row?.cwd ?? get().listRoot;
  }

  async function killWorker(
    sessionId: string,
    cwd: string | null,
  ): Promise<void> {
    await window.api.sessions.killWorker(sessionId);
    const root = resolveRefreshRoot(sessionId, cwd);
    if (root) await refresh(root);
  }

  async function restartWorker(
    sessionId: string,
    cwd: string | null,
  ): Promise<void> {
    await window.api.sessions.restartWorker(sessionId);
    const root = resolveRefreshRoot(sessionId, cwd);
    if (root) await refresh(root);
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
      const list = get().sessions;
      const idx = list.findIndex((s) => s.id === sessionId);
      if (idx >= 0) {
        const row = list[idx];
        commit({
          sessions: list.map((s, i) =>
            i === idx
              ? { ...row, name: trimmed, modified: new Date().toISOString() }
              : s,
          ),
        });
      }
    }
    const updated = await window.api.sessions.rename(sessionId, cwd, trimmed);
    if (updated) upsert({ ...updated, name: updated.name?.trim() || trimmed });
    return updated;
  }

  /**
   * 注册会话列表状态订阅，返回解绑函数（重复调用返回同一个）。
   * 由应用级 bootstrap 持有：与 chat store 共用同一推送流，任一侧漏订阅都会
   * 让侧栏状态与聊天区脱节。
   */
  function bindEvents(): () => void {
    if (unbind) return unbind;
    const off = window.api.sessions.onEvent((event) => {
      applyEvent(event);
    });
    unbind = () => {
      unbind = null;
      off();
    };
    return unbind;
  }


  return {
    ...base,
    ...derive(base),
    applyContextFromState,
    applyStatus: patchStatus,
    replaceList,
    refresh,
    beginDraft,
    setDraftRoot,
    commitDraft,
    selectSession,
    discardActiveIfUnstarted,
    discardUnstartedOnQuit,
    sendCommand,
    tryCommand,
    killWorker,
    restartWorker,
    deleteSession,
    renameSession,
    bindEvents,
  };
});

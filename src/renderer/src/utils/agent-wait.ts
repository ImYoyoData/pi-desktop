/**
 * Derive human-facing wait phase while an agent turn is in flight.
 * Used by the chat running indicator so long waits don't look "frozen".
 */

import type { ChatState } from "../stores/chat-reducer";

export type AgentWaitPhase =
  | "starting"
  | "waiting_model"
  | "thinking"
  | "writing"
  | "tool"
  | "compacting"
  | "waiting_user";

export function agentWaitPhase(state: ChatState): AgentWaitPhase | null {
  if (!state.running) return null;
  if (state.pendingAskUser || state.pendingExtensionUi || state.pendingPermission) {
    return "waiting_user";
  }
  if (state.compaction) return "compacting";
  const stream = state.streamingMessage;
  if (stream?.role === "tool") return "tool";
  if (stream?.role === "assistant") {
    const text = stream.text?.trim() ?? "";
    const thinking = stream.thinking?.trim() ?? "";
    if (text) return "writing";
    if (thinking) return "thinking";
    return "thinking";
  }
  if (state.retryHint) return "waiting_model";
  if (!state.turnStartedAt) return "starting";
  return "waiting_model";
}

export function agentWaitToolName(state: ChatState): string | null {
  const stream = state.streamingMessage;
  if (stream?.role === "tool" && stream.toolName) return stream.toolName;
  return null;
}

export type AgentWaitNetwork = {
  stage: "sent" | "response" | "failed";
  host: string;
  status?: number;
  /** 请求抛错的原因（DNS / 超时 / 连接被拒），只在 failed 阶段出现。 */
  error?: string;
  elapsedMs: number;
};

/** 错误串可能是一整页 HTML：压成一行并截断，避免撑爆等待指示器。 */
export function clipRequestError(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * 当前模型请求卡在网络层时，报告卡在哪个阶段。
 */
export function agentWaitNetwork(
  state: ChatState,
  now = Date.now(),
): AgentWaitNetwork | null {
  const progress = state.llmProgress;
  if (!state.running || !progress) return null;
  const from =
    progress.stage === "sent"
      ? progress.startedAt
      : (progress.respondedAt ?? progress.startedAt);
  const error = progress.error ? clipRequestError(progress.error) : "";
  return {
    stage: progress.stage,
    host: progress.host,
    ...(progress.status != null ? { status: progress.status } : {}),
    ...(error ? { error } : {}),
    elapsedMs: Math.max(0, now - from),
  };
}

/** 请求发出后多久还没收到响应头，就提示可能在等网络 / 代理。 */
export const CONNECT_SLOW_MS = 20_000;

export type AgentWaitHttpKind = "ok" | "limited" | "server" | "rejected";

/** 把 HTTP 状态码归成界面需要区分的几类。 */
export function httpStatusKind(
  status: number | undefined,
): AgentWaitHttpKind | null {
  if (status == null) return null;
  if (status === 429) return "limited";
  if (status >= 500) return "server";
  if (status >= 400) return "rejected";
  return "ok";
}

/** 本回合第几轮模型调用、已跑几个工具（工具序号减一）。 */
export function agentWaitRound(
  state: ChatState,
): { round: number; tools: number } | null {
  if (!state.running || state.llmRound <= 0) return null;
  return { round: state.llmRound, tools: Math.max(0, state.nextToolOrder - 1) };
}

/** Stable id for the current wait phase (tool name included). */
export function agentWaitPhaseId(state: ChatState): string {
  const phase = agentWaitPhase(state);
  if (!phase) return "idle";
  if (phase === "tool") return `tool:${agentWaitToolName(state) ?? ""}`;
  return phase;
}

/**
 * Keep turnStartedAt as the whole-turn clock; reset phaseStartedAt whenever
 * the wait phase changes (waiting_model → thinking → writing → tool → …).
 */
export function syncPhaseClock(
  prev: ChatState,
  next: ChatState,
  now = Date.now(),
): ChatState {
  if (!next.running) {
    if (next.phaseStartedAt == null) return next;
    return { ...next, phaseStartedAt: null };
  }
  const nextId = agentWaitPhaseId(next);
  const prevId = prev.running ? agentWaitPhaseId(prev) : "";
  if (prevId !== nextId || next.phaseStartedAt == null) {
    return { ...next, phaseStartedAt: now };
  }
  return next;
}

/** Silence since last agent output / stream chunk (ms). */
export function agentOutputSilenceMs(state: ChatState, now = Date.now()): number {
  if (!state.running || !state.lastActivityAt) return 0;
  return Math.max(0, now - state.lastActivityAt);
}

/** Silence since last worker heartbeat pong during a turn (ms). */
export function agentWorkerSilenceMs(state: ChatState, now = Date.now()): number {
  if (!state.running) return 0;
  if (!state.lastWorkerAliveAt) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - state.lastWorkerAliveAt);
}

/** 12_300 → "12.3k"，用于压缩前占用。 */
export { formatTokenCount } from "./message-metrics";

export function formatElapsedShort(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return rem ? `${min}m ${rem}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${hr}h ${m}m` : `${hr}h`;
}

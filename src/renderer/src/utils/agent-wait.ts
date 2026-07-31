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
  | "waiting_user";

export function agentWaitPhase(state: ChatState): AgentWaitPhase | null {
  if (!state.running) return null;
  if (state.pendingAskUser || state.pendingPermission || state.pendingExtensionUi) {
    return "waiting_user";
  }
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

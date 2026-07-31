/**
 * Pure helpers for agent auto-recover (worker stuck / soft hang).
 * Renderer orchestrates restart + resend; this module owns thresholds/budget.
 */

export type AutoRecoverReason = "worker_stuck" | "soft_hang" | "stall";

/** Consecutive auto-recover attempts allowed per session before giving up. */
export const AUTO_RECOVER_MAX = 2;

/** Soft hang: output silence while worker heartbeats are still fresh (ms). */
export const SOFT_HANG_SILENCE_MS = 180_000;

/** Worker heartbeat considered "alive" for soft-hang detection (ms). */
export const SOFT_HANG_WORKER_ALIVE_MS = 20_000;

/**
 * Event-loop stall: worker heartbeats AND output both silent this long while a
 * turn is running. The worker answers pings before any command work, so total
 * silence past this window means the loop is wedged (stdout pipe backpressure,
 * deadlock, OOM thrash), not slow work. Mirrors STALL_EMIT_MS in main.
 */
export const STALL_SILENCE_MS = 75_000;

export type SoftHangInput = {
  running: boolean;
  /** Waiting on ask_user / permission / extension UI. */
  waitingUser: boolean;
  /**
   * True while a tool card is streaming (bash / subagent / long tools).
   * Soft hang must not abort these — silence is normal until the tool returns.
   */
  toolInFlight: boolean;
  outputSilenceMs: number;
  workerSilenceMs: number;
};

export function canAutoRecover(count: number, max = AUTO_RECOVER_MAX): boolean {
  return count < max;
}

export function nextAutoRecoverCount(count: number): number {
  return Math.max(0, count) + 1;
}

/**
 * Soft hang: turn running, not waiting on user, no tool in flight, long output
 * silence, but worker still answering heartbeats (so main won't emit worker_stuck).
 */
export function shouldSoftHangRecover(input: SoftHangInput): boolean {
  if (!input.running || input.waitingUser || input.toolInFlight) return false;
  if (input.outputSilenceMs < SOFT_HANG_SILENCE_MS) return false;
  if (!Number.isFinite(input.workerSilenceMs)) return false;
  return input.workerSilenceMs < SOFT_HANG_WORKER_ALIVE_MS;
}

export type StallInput = {
  running: boolean;
  /** Waiting on ask_user / permission / extension UI. */
  waitingUser: boolean;
  outputSilenceMs: number;
  workerSilenceMs: number;
};

/**
 * Event-loop stall: turn running, not waiting on user, and BOTH output and
 * heartbeats silent past STALL_SILENCE_MS. Unlike soft hang this intentionally
 * ignores toolInFlight — a wedged event loop can never finish the tool either,
 * and a live subagent/tool keeps answering pings, so false positives need a
 * blocked loop to even reach this state.
 *
 * `workerSilenceMs` of Infinity (no heartbeat signal received at all this turn)
 * counts as stalled: a healthy worker answers pings within seconds of the turn
 * starting, and a worker that never becomes ready fails within the 45s spawn
 * window and ends the turn — so Infinity persisting past the stall window
 * means the worker is unresponsive, not initializing.
 */
export function shouldStallRecover(input: StallInput): boolean {
  if (!input.running || input.waitingUser) return false;
  return (
    input.outputSilenceMs >= STALL_SILENCE_MS &&
    input.workerSilenceMs >= STALL_SILENCE_MS
  );
}

/** Soft hang only gets one of the shared recover budget slots in practice via reason. */
export function maxAttemptsForReason(reason: AutoRecoverReason): number {
  switch (reason) {
    case "worker_stuck":
    case "stall":
      return AUTO_RECOVER_MAX;
    case "soft_hang":
      return 1;
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

export function canAutoRecoverForReason(
  count: number,
  reason: AutoRecoverReason,
): boolean {
  return count < maxAttemptsForReason(reason);
}

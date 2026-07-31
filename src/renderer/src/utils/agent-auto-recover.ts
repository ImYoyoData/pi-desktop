/**
 * Pure helpers for agent auto-recover (worker stuck / soft hang).
 * Renderer orchestrates restart + resend; this module owns thresholds/budget.
 */

export type AutoRecoverReason = "worker_stuck" | "soft_hang";

/** Consecutive auto-recover attempts allowed per session before giving up. */
export const AUTO_RECOVER_MAX = 2;

/** Soft hang: output silence while worker heartbeats are still fresh (ms). */
export const SOFT_HANG_SILENCE_MS = 180_000;

/** Worker heartbeat considered "alive" for soft-hang detection (ms). */
export const SOFT_HANG_WORKER_ALIVE_MS = 20_000;

export type SoftHangInput = {
  running: boolean;
  /** Waiting on ask_user / permission / extension UI. */
  waitingUser: boolean;
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
 * Soft hang: turn running, not waiting on user, long output silence,
 * but worker still answering heartbeats (so main won't emit worker_stuck).
 */
export function shouldSoftHangRecover(input: SoftHangInput): boolean {
  if (!input.running || input.waitingUser) return false;
  if (input.outputSilenceMs < SOFT_HANG_SILENCE_MS) return false;
  if (!Number.isFinite(input.workerSilenceMs)) return false;
  return input.workerSilenceMs < SOFT_HANG_WORKER_ALIVE_MS;
}

/** Soft hang only gets one of the shared recover budget slots in practice via reason. */
export function maxAttemptsForReason(reason: AutoRecoverReason): number {
  switch (reason) {
    case "worker_stuck":
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

/**
 * Detect stuck bash/terminal runs: still "running", not backgrounded,
 * and no stdout/stderr for a long stretch.
 */

/** No output for this long → interrupt the command (not the whole session). */
export const BASH_STALL_SILENCE_MS = 120_000;

export type BashStallInput = {
  status: "running" | "terminating" | string;
  /** Backgrounded runs are user-owned; never auto-kill. */
  detached?: boolean;
  startedAt: number;
  /** Wall clock of last stdout/stderr chunk (defaults to startedAt when absent). */
  lastOutputAt?: number;
};

export function bashStallSilenceMs(input: BashStallInput, now = Date.now()): number {
  const last = input.lastOutputAt ?? input.startedAt;
  return Math.max(0, now - last);
}

export function shouldInterruptBashStall(
  input: BashStallInput,
  now = Date.now(),
  silenceMs = BASH_STALL_SILENCE_MS,
): boolean {
  if (input.status !== "running") return false;
  if (input.detached) return false;
  return bashStallSilenceMs(input, now) >= silenceMs;
}

import { describe, expect, it } from "vitest";
import {
  AUTO_RECOVER_MAX,
  canAutoRecover,
  canAutoRecoverForReason,
  nextAutoRecoverCount,
  shouldSoftHangRecover,
  SOFT_HANG_SILENCE_MS,
} from "../../src/renderer/src/utils/agent-auto-recover";

describe("agent-auto-recover", () => {
  it("allows recover until the shared budget is exhausted", () => {
    expect(canAutoRecover(0)).toBe(true);
    expect(canAutoRecover(AUTO_RECOVER_MAX - 1)).toBe(true);
    expect(canAutoRecover(AUTO_RECOVER_MAX)).toBe(false);
    expect(nextAutoRecoverCount(0)).toBe(1);
    expect(nextAutoRecoverCount(1)).toBe(2);
  });

  it("limits soft_hang to one attempt", () => {
    expect(canAutoRecoverForReason(0, "soft_hang")).toBe(true);
    expect(canAutoRecoverForReason(1, "soft_hang")).toBe(false);
    expect(canAutoRecoverForReason(1, "worker_stuck")).toBe(true);
    expect(canAutoRecoverForReason(2, "worker_stuck")).toBe(false);
  });

  it("detects soft hang only when worker is alive and silence is long", () => {
    expect(
      shouldSoftHangRecover({
        running: true,
        waitingUser: false,
        toolInFlight: false,
        outputSilenceMs: SOFT_HANG_SILENCE_MS,
        workerSilenceMs: 5_000,
      }),
    ).toBe(true);

    expect(
      shouldSoftHangRecover({
        running: true,
        waitingUser: true,
        toolInFlight: false,
        outputSilenceMs: SOFT_HANG_SILENCE_MS,
        workerSilenceMs: 5_000,
      }),
    ).toBe(false);

    expect(
      shouldSoftHangRecover({
        running: true,
        waitingUser: false,
        toolInFlight: true,
        outputSilenceMs: SOFT_HANG_SILENCE_MS,
        workerSilenceMs: 5_000,
      }),
    ).toBe(false);

    expect(
      shouldSoftHangRecover({
        running: true,
        waitingUser: false,
        toolInFlight: false,
        outputSilenceMs: SOFT_HANG_SILENCE_MS - 1,
        workerSilenceMs: 5_000,
      }),
    ).toBe(false);

    expect(
      shouldSoftHangRecover({
        running: true,
        waitingUser: false,
        toolInFlight: false,
        outputSilenceMs: SOFT_HANG_SILENCE_MS,
        workerSilenceMs: Number.POSITIVE_INFINITY,
      }),
    ).toBe(false);
  });
});

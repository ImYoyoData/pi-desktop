import { describe, expect, it } from "vitest";
import { TIMER_GAP_MS, timerGapDetected } from "../../src/shared/timer-gap";

describe("timer-gap", () => {
  it("treats a normal tick interval as no gap", () => {
    expect(timerGapDetected(1_000, 1_000 + 5_000)).toBe(false);
    expect(timerGapDetected(1_000, 1_000 + TIMER_GAP_MS)).toBe(false);
  });

  it("treats a suspend-sized hole as a gap", () => {
    expect(timerGapDetected(1_000, 1_000 + TIMER_GAP_MS + 1)).toBe(true);
    expect(timerGapDetected(1_000, 1_000 + 3_600_000)).toBe(true);
  });

  it("ignores the first tick, when no previous tick is known", () => {
    expect(timerGapDetected(0, 1_000 + 3_600_000)).toBe(false);
  });
});

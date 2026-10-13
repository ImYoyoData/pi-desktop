import { describe, expect, it } from "vitest";
import {
  AUTO_COVER_SUPPRESS_MS,
  WINDOW_REVERSE_COOLDOWN_MS,
  WINDOW_REVERSE_MAX,
  WINDOW_REVERSE_WINDOW_MS,
  allowWindowAdjust,
  createWindowAdjustGate,
  noteWindowAdjust,
  trimLineIsSafe,
  type WindowAdjustGate,
} from "../../src/renderer/src/utils/message-virtual-window";

const T0 = 1_000_000;

function after(gate: WindowAdjustGate, dir: "up" | "down", now: number): WindowAdjustGate {
  return noteWindowAdjust(gate, dir, now);
}

/**
 * 连续反向 WINDOW_REVERSE_MAX + 1 次即可触发振荡判定（判据是严格大于）。
 * 每次间隔取冷却值，保证始终落在滑动窗口内，不会因过期而重置计数。
 */
function oscillate(reversals: number, stepMs = WINDOW_REVERSE_COOLDOWN_MS) {
  let gate = createWindowAdjustGate(T0);
  let now = T0;
  gate = after(gate, "up", now);
  now += stepMs;
  for (let i = 0; i < reversals; i++) {
    gate = after(gate, i % 2 === 0 ? "down" : "up", now);
    now += stepMs;
  }
  return { gate, now };
}

describe("allowWindowAdjust", () => {
  it("allows the first adjustment", () => {
    expect(allowWindowAdjust(createWindowAdjustGate(T0), "up", T0)).toBe(true);
  });

  it("allows consecutive same-direction adjustments without cooldown", () => {
    const gate = after(createWindowAdjustGate(T0), "up", T0);
    expect(allowWindowAdjust(gate, "up", T0)).toBe(true);
    expect(allowWindowAdjust(gate, "up", T0 + 10)).toBe(true);
  });

  it("blocks a reversal that arrives within the base cooldown", () => {
    const gate = after(createWindowAdjustGate(T0), "up", T0);
    expect(allowWindowAdjust(gate, "down", T0)).toBe(false);
    expect(allowWindowAdjust(gate, "down", T0 + WINDOW_REVERSE_COOLDOWN_MS - 1)).toBe(false);
  });

  it("allows a reversal once the cooldown elapsed", () => {
    const gate = after(createWindowAdjustGate(T0), "up", T0);
    expect(allowWindowAdjust(gate, "down", T0 + WINDOW_REVERSE_COOLDOWN_MS)).toBe(true);
  });

  it("lengthens the cooldown while oscillation suppression is active", () => {
    const { gate, now } = oscillate(WINDOW_REVERSE_MAX + 1);
    expect(gate.suppressedUntil).toBeGreaterThan(0);

    const fresh = after(gate, "down", now);
    expect(allowWindowAdjust(fresh, "up", now)).toBe(false);
    expect(allowWindowAdjust(fresh, "up", now + WINDOW_REVERSE_COOLDOWN_MS)).toBe(false);
    expect(allowWindowAdjust(fresh, "up", now + AUTO_COVER_SUPPRESS_MS)).toBe(true);
  });

  it("does not suppress before the reversal limit is exceeded", () => {
    const { gate } = oscillate(WINDOW_REVERSE_MAX);
    expect(gate.reverseCount).toBe(WINDOW_REVERSE_MAX);
    expect(gate.suppressedUntil).toBe(0);
  });
});

describe("noteWindowAdjust", () => {
  it("keeps the gate mutable-free: returns a new state object", () => {
    const gate = createWindowAdjustGate(T0);
    const next = after(gate, "up", T0);
    expect(gate.lastDir).toBeNull();
    expect(next.lastDir).toBe("up");
  });

  it("counts reversals within the sliding window", () => {
    let gate = createWindowAdjustGate(T0);
    gate = after(gate, "up", T0);
    gate = after(gate, "down", T0 + 200);
    expect(gate.reverseCount).toBe(1);
    gate = after(gate, "up", T0 + 400);
    expect(gate.reverseCount).toBe(2);
  });

  it("forgets reversals once the window elapsed", () => {
    let gate = createWindowAdjustGate(T0);
    gate = after(gate, "up", T0);
    gate = after(gate, "down", T0 + 200);
    expect(gate.reverseCount).toBe(1);
    gate = after(gate, "up", T0 + WINDOW_REVERSE_WINDOW_MS + 1);
    expect(gate.reverseCount).toBe(1);
  });

  it("resets the counter and suppresses after exceeding the reversal limit", () => {
    const { gate } = oscillate(WINDOW_REVERSE_MAX + 1);
    expect(gate.reverseCount).toBe(0);
    expect(gate.suppressedUntil).toBeGreaterThan(0);
  });
});

describe("trimLineIsSafe", () => {
  const TOP = 1_000;
  const BOTTOM = 1_800;
  const OVERSCAN = 280;
  const safe = (dir: "up" | "down", trimLineTop: number, margin?: number) =>
    trimLineIsSafe({ dir, trimLineTop, viewportTop: TOP, viewportBottom: BOTTOM, overscanPx: OVERSCAN, margin });

  it("keeps the trim line below the viewport when expanding up", () => {
    expect(safe("up", BOTTOM + OVERSCAN + 1)).toBe(true);
    expect(safe("up", BOTTOM + OVERSCAN)).toBe(false);
  });

  it("refuses to trim a line inside the viewport when expanding up", () => {
    expect(safe("up", BOTTOM - 1)).toBe(false);
  });

  it("keeps the trim line above the viewport when expanding down", () => {
    expect(safe("down", TOP - OVERSCAN - 1)).toBe(true);
    expect(safe("down", TOP - OVERSCAN)).toBe(false);
  });

  it("refuses to trim a line inside the viewport when expanding down", () => {
    expect(safe("down", BOTTOM - 1)).toBe(false);
  });

  it("adds the margin so estimates biased low cannot trim the viewport", () => {
    // 估算裁剪线刚好在视口外一像素：没有余量时会裁到视口内的行。
    const line = BOTTOM + OVERSCAN + 1;
    expect(safe("up", line)).toBe(true);
    expect(safe("up", line, 50)).toBe(false);
  });

  it("uses viewport top as the reference when expanding down with a margin", () => {
    const line = TOP - OVERSCAN - 1;
    expect(safe("down", line)).toBe(true);
    expect(safe("down", line, 50)).toBe(false);
  });

  it("is symmetric: opposite directions disagree on the same line", () => {
    const line = BOTTOM + OVERSCAN + 1;
    expect(safe("up", line)).toBe(true);
    expect(safe("down", line)).toBe(false);
  });
});
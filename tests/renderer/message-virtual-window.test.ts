import { describe, expect, it } from "vitest";
import {
  ensureIndexInVirtualWindow,
  followBottomVirtualWindow,
  windowAfterHistoryPrepend,
} from "../../src/renderer/src/utils/message-virtual-window";

describe("ensureIndexInVirtualWindow", () => {
  it("is idempotent when window already trimmed around an in-range index", () => {
    const first = ensureIndexInVirtualWindow({ start: 0, end: 120 }, 10, 200, 48);
    expect(first.window.end - first.window.start).toBeLessThanOrEqual(48);
    expect(first.changed).toBe(true);

    const second = ensureIndexInVirtualWindow(first.window, 10, 200, 48);
    expect(second.changed).toBe(false);
    expect(second.window).toEqual(first.window);
  });

  it("does not report changed when clamp assignments are no-ops", () => {
    const window = { start: 50, end: 98 };
    const again = ensureIndexInVirtualWindow(window, 60, 200, 48);
    expect(again.changed).toBe(false);
    expect(again.window).toEqual(window);
  });

  it("expands upward when index is above the window", () => {
    const result = ensureIndexInVirtualWindow({ start: 80, end: 112 }, 40, 200, 48);
    expect(result.changed).toBe(true);
    expect(result.window.start).toBeLessThanOrEqual(40);
    expect(result.window.end - result.window.start).toBeLessThanOrEqual(48);
    expect(40 >= result.window.start && 40 < result.window.end).toBe(true);
  });
});

describe("followBottomVirtualWindow", () => {
  it("never expands beyond the configured window size", () => {
    const w = followBottomVirtualWindow(500, 32);
    expect(w.end).toBe(500);
    expect(w.start).toBe(468);
    expect(w.end - w.start).toBe(32);
  });
});

describe("windowAfterHistoryPrepend", () => {
  it("shifts the mounted window instead of jumping to the list head", () => {
    // Viewing indices 0..48 of the already-loaded tail; 30 older rows prepend.
    const next = windowAfterHistoryPrepend({ start: 0, end: 48 }, 30, 200, 48, 16);
    expect(next.start).toBe(14); // 0+30-16
    expect(next.end).toBe(62); // start+48
    // Previously-visible first row is now at index 30 — still inside the window.
    expect(next.start).toBeLessThanOrEqual(30);
    expect(next.end).toBeGreaterThan(30);
  });

  it("keeps size within maxSize", () => {
    const next = windowAfterHistoryPrepend({ start: 10, end: 50 }, 40, 300, 48, 16);
    expect(next.end - next.start).toBeLessThanOrEqual(48);
  });
});

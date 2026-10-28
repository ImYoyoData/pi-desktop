import { describe, expect, it } from "vitest";
import {
  innerScrollCanSwallow,
  type InnerScrollMetrics,
} from "../../src/renderer/src/utils/inner-scroll";

function metrics(overrides: Partial<InnerScrollMetrics> = {}): InnerScrollMetrics {
  return {
    scrollHeight: 900,
    clientHeight: 420,
    scrollTop: 100,
    ...overrides,
  };
}

describe("innerScrollCanSwallow", () => {
  it("owns the wheel while the region can still scroll either way", () => {
    expect(innerScrollCanSwallow(metrics(), -1)).toBe(true);
    expect(innerScrollCanSwallow(metrics(), 1)).toBe(true);
  });

  it("hands the wheel back once the region reaches its edge", () => {
    expect(innerScrollCanSwallow(metrics({ scrollTop: 0 }), -1)).toBe(false);
    expect(innerScrollCanSwallow(metrics({ scrollTop: 480 }), 1)).toBe(false);
  });

  it("never owns a purely horizontal scroll or a non-scrolling region", () => {
    expect(innerScrollCanSwallow(metrics(), 0)).toBe(false);
    expect(innerScrollCanSwallow(metrics({ scrollHeight: 420 }), -1)).toBe(false);
  });
});

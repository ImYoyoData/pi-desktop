import { describe, expect, it } from "vitest";
import { clampPanelWidth } from "../../src/renderer/src/stores/layout-utils";

describe("clampPanelWidth", () => {
  it("returns px when within bounds", () => {
    expect(clampPanelWidth(240)).toBe(240);
  });

  it("clamps below minimum", () => {
    expect(clampPanelWidth(100)).toBe(180);
  });

  it("clamps above maximum", () => {
    expect(clampPanelWidth(800)).toBe(560);
  });

  it("respects custom min and max", () => {
    expect(clampPanelWidth(50, 60, 120)).toBe(60);
    expect(clampPanelWidth(200, 60, 120)).toBe(120);
  });
});

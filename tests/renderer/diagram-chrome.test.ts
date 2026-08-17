import { describe, expect, it } from "vitest";
import { clampDiagramZoom } from "../../src/renderer/src/utils/diagram-chrome";

describe("diagram-chrome zoom", () => {
  it("clamps zoom range", () => {
    expect(clampDiagramZoom(0.1)).toBe(0.35);
    expect(clampDiagramZoom(9)).toBe(6);
    expect(clampDiagramZoom(1.5)).toBe(1.5);
  });
});

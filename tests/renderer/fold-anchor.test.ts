import { describe, expect, it } from "vitest";
import {
  foldAnchorScrollDelta,
  type FoldAnchorMetrics,
} from "../../src/renderer/src/utils/fold-anchor";

function metrics(overrides: Partial<FoldAnchorMetrics> = {}): FoldAnchorMetrics {
  return {
    anchorTop: 215,
    headTop: 215,
    blockBottom: 235,
    viewTop: 0,
    viewBottom: 290,
    ...overrides,
  };
}

describe("foldAnchorScrollDelta", () => {
  it("keeps the viewport still when the expanded block still fits", () => {
    expect(foldAnchorScrollDelta(metrics({ blockBottom: 285 }))).toBe(0);
  });

  it("pins the clicked row again when something else moved it", () => {
    expect(foldAnchorScrollDelta(metrics({ headTop: 195, blockBottom: 215 }))).toBe(-20);
  });

  it("scrolls just enough to show a block that overflows the bottom", () => {
    expect(foldAnchorScrollDelta(metrics({ blockBottom: 500 }))).toBe(210);
  });

  it("never scrolls the clicked row past the top of the viewport", () => {
    expect(foldAnchorScrollDelta(metrics({ blockBottom: 900 }))).toBe(215);
  });

  it("does not scroll downward when the row already sits at the top", () => {
    expect(foldAnchorScrollDelta(metrics({ anchorTop: 0, headTop: 0, blockBottom: 400 }))).toBe(0);
  });
});

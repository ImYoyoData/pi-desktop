import { describe, expect, it } from "vitest";
import { splitPaneSizes, type SplitLayoutInput } from "../../src/renderer/src/utils/split-layout";

function layout(overrides: Partial<SplitLayoutInput> = {}): SplitLayoutInput {
  return {
    leftSize: 20,
    centerSize: 30,
    rightSize: 50,
    bottomSize: 30,
    leftCollapsed: false,
    rightCollapsed: false,
    bottomCollapsed: false,
    editorMaximized: false,
    ...overrides,
  };
}

describe("splitPaneSizes", () => {
  it("splits the main column by the centre/right ratio", () => {
    const sizes = splitPaneSizes(layout());
    expect(sizes.outerLeft).toBe(20);
    expect(sizes.outerMain).toBe(80);
    expect(sizes.chat).toBeCloseTo(37.5);
    expect(sizes.rightPane).toBeCloseTo(62.5);
    expect(sizes.chatVisible).toBe(true);
  });

  it("falls back to the default ratio when both sizes are lost", () => {
    const sizes = splitPaneSizes(layout({ centerSize: 0, rightSize: 0 }));
    expect(sizes.chat).toBeCloseTo(37.5);
    expect(sizes.rightPane).toBeCloseTo(62.5);
  });

  it("gives the whole main column to chat while the right pane is collapsed", () => {
    const sizes = splitPaneSizes(layout({ rightCollapsed: true }));
    expect(sizes.chat).toBe(100);
    expect(sizes.rightPane).toBe(0);
  });

  it("collapses the chat column when the editor area is maximized", () => {
    const sizes = splitPaneSizes(layout({ editorMaximized: true, bottomCollapsed: true }));
    expect(sizes.chat).toBe(0);
    expect(sizes.rightPane).toBe(100);
    expect(sizes.chatVisible).toBe(false);
    expect(sizes.chatTop).toBe(100);
    expect(sizes.bottomPanel).toBe(0);
  });

  it("keeps the bottom panel full height while maximized and expanded", () => {
    const sizes = splitPaneSizes(layout({ editorMaximized: true, bottomCollapsed: false }));
    expect(sizes.chatTop).toBe(0);
    expect(sizes.bottomPanel).toBe(100);
  });

  it("hands the main column to the left pane when it is collapsed", () => {
    const sizes = splitPaneSizes(layout({ leftCollapsed: true }));
    expect(sizes.outerLeft).toBe(0);
    expect(sizes.outerMain).toBe(100);
    expect(sizes.leftHidden).toBe(true);
  });

  it("splits chat and bottom panel by the bottom size", () => {
    const sizes = splitPaneSizes(layout({ bottomSize: 30 }));
    expect(sizes.chatTop).toBeCloseTo(70);
    expect(sizes.bottomPanel).toBe(30);
  });

  it("hides the bottom panel when collapsed", () => {
    const sizes = splitPaneSizes(layout({ bottomCollapsed: true }));
    expect(sizes.chatTop).toBe(100);
    expect(sizes.bottomPanel).toBe(0);
  });
});

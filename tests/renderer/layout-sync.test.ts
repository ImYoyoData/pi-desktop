import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYOUT,
  samePersistedLayout,
  type PersistedLayout,
} from "../../src/renderer/src/stores/layout-utils";

function layout(overrides: Partial<PersistedLayout> = {}): PersistedLayout {
  return { ...DEFAULT_LAYOUT, ...overrides };
}

describe("samePersistedLayout", () => {
  it("treats an identical layout as unchanged", () => {
    expect(samePersistedLayout(layout(), layout())).toBe(true);
  });

  it("detects each pane and collapse change", () => {
    const base = layout();
    const dirty: Partial<PersistedLayout>[] = [
      { leftSize: 21 },
      { centerSize: 31 },
      { rightSize: 49 },
      { leftCollapsed: true },
      { rightCollapsed: false },
      { bottomSize: 31 },
      { bottomCollapsed: false },
      { centerView: "customize" },
      { customizeSection: "general" },
      { editorMaximized: true },
    ];
    for (const patch of dirty) {
      expect(samePersistedLayout(base, layout(patch))).toBe(false);
    }
  });

  it("compares the pre-maximize snapshot by value", () => {
    const preMaximize = {
      leftCollapsed: true,
      rightCollapsed: false,
      bottomCollapsed: true,
      leftSize: 20,
      centerSize: 35,
      rightSize: 45,
    };
    expect(samePersistedLayout(layout({ preMaximize }), layout({ preMaximize: { ...preMaximize } }))).toBe(
      true,
    );
    expect(samePersistedLayout(layout({ preMaximize }), layout({ preMaximize: null }))).toBe(false);
    expect(
      samePersistedLayout(layout({ preMaximize }), layout({ preMaximize: { ...preMaximize, rightSize: 44 } })),
    ).toBe(false);
  });
});

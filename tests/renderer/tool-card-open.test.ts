import { describe, expect, it } from "vitest";
import {
  isToolCardOpen,
  toolCardAutoExpandAllowed,
  type ToolCardOpenInput,
} from "../../src/renderer/src/utils/tool-card-open";

/**
 * Cards kept auto-expanding during a turn, burying the answer under diffs and file
 * dumps, and the detail rows inside a grouped work-section expanded on top of the
 * group's own summary. Both had to stop; these pin the resulting rule.
 */
function input(partial: Partial<ToolCardOpenInput> = {}): ToolCardOpenInput {
  return {
    kind: "read",
    expandToolCalls: false,
    detailCollapsed: false,
    autoCollapse: false,
    streaming: false,
    manuallyOpen: null,
    ...partial,
  };
}

describe("toolCardAutoExpandAllowed", () => {
  it("allows the mutating / command kinds", () => {
    for (const kind of ["write", "edit", "bash", "todo"] as const) {
      expect(toolCardAutoExpandAllowed(kind)).toBe(true);
    }
  });

  it("never allows reads or generic tools (huge dumps)", () => {
    for (const kind of ["read", "generic", "other"] as const) {
      expect(toolCardAutoExpandAllowed(kind)).toBe(false);
    }
  });
});

describe("isToolCardOpen — setting off (default)", () => {
  it("keeps every kind folded even while streaming", () => {
    for (const kind of ["read", "write", "edit", "bash", "todo", "generic", "other"] as const) {
      expect(isToolCardOpen(input({ kind, streaming: true }))).toBe(false);
    }
  });

  it("respects an explicit user toggle", () => {
    expect(isToolCardOpen(input({ manuallyOpen: true }))).toBe(true);
    expect(isToolCardOpen(input({ manuallyOpen: false }))).toBe(false);
  });
});

describe("isToolCardOpen — setting on", () => {
  it("expands mutating kinds only while streaming", () => {
    expect(isToolCardOpen(input({ kind: "edit", expandToolCalls: true, streaming: true }))).toBe(true);
    expect(isToolCardOpen(input({ kind: "edit", expandToolCalls: true, streaming: false }))).toBe(false);
  });

  it("still keeps reads folded", () => {
    expect(isToolCardOpen(input({ kind: "read", expandToolCalls: true, streaming: true }))).toBe(false);
  });
});

describe("isToolCardOpen — grouped detail rows", () => {
  it("stays folded regardless of the setting and streaming state", () => {
    for (const kind of ["edit", "bash", "write", "todo"] as const) {
      expect(
        isToolCardOpen(
          input({ kind, detailCollapsed: true, expandToolCalls: true, streaming: true }),
        ),
      ).toBe(false);
    }
  });

  it("can still be opened by hand", () => {
    expect(
      isToolCardOpen(input({ kind: "edit", detailCollapsed: true, expandToolCalls: true, manuallyOpen: true })),
    ).toBe(true);
  });
});

describe("isToolCardOpen — settled history", () => {
  it("folds unless the user expanded it", () => {
    expect(
      isToolCardOpen(input({ kind: "edit", expandToolCalls: true, streaming: true, autoCollapse: true })),
    ).toBe(false);
    expect(
      isToolCardOpen(
        input({ kind: "edit", expandToolCalls: true, autoCollapse: true, manuallyOpen: true }),
      ),
    ).toBe(true);
  });

  it("honours an explicit collapse even mid-stream", () => {
    expect(
      isToolCardOpen(input({ kind: "bash", expandToolCalls: true, streaming: true, manuallyOpen: false })),
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { buildSelectElementScript, SELECT_ELEMENT_CONSOLE_PREFIX } from "../../src/main/select-element-script";
import { isRegionCitation } from "../../src/shared/protocol";

describe("select-element region capture", () => {
  it("injects drag-to-region marquee handlers", () => {
    const src = buildSelectElementScript("en");
    expect(src).toContain("mousedown");
    expect(src).toContain("pi-select-region-box");
    expect(src).toContain("pi-select-hover-box");
    expect(src).toContain("pi-select-hover-tip");
    expect(src).toContain("Click to select, drag to draw");
    expect(src).toContain('kind: "region"');
    expect(src).toContain(SELECT_ELEMENT_CONSOLE_PREFIX);
    expect(src).toContain("cancel");
  });

  it("localizes hover tip for zh-CN", () => {
    const src = buildSelectElementScript("zh-CN");
    expect(src).toContain("点击选择，拖拽框选");
    expect(src).toContain("区域");
    expect(src).not.toContain("Click to select, drag to draw");
  });

  it("detects region citations", () => {
    expect(isRegionCitation({ kind: "region", selector: "div" })).toBe(true);
    expect(isRegionCitation({ selector: "[region]" })).toBe(true);
    expect(isRegionCitation({ kind: "element", selector: "#x" })).toBe(false);
  });
});

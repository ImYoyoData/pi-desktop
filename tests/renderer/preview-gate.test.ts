import { describe, expect, it } from "vitest";
import { previewWantsContent } from "../../src/renderer/src/utils/preview-gate";

describe("previewWantsContent", () => {
  it("mounts the content of the active tab", () => {
    expect(previewWantsContent({ active: true, dirty: false, missing: false })).toBe(true);
  });

  it("skips a hidden, clean tab so it is not rendered twice", () => {
    expect(previewWantsContent({ active: false, dirty: false, missing: false })).toBe(false);
  });

  it("keeps hidden dirty tabs mounted so drafts survive", () => {
    expect(previewWantsContent({ active: false, dirty: true, missing: false })).toBe(true);
  });

  it("keeps deleted-file tabs mounted so the alert stays visible", () => {
    expect(previewWantsContent({ active: false, dirty: false, missing: true })).toBe(true);
  });
});

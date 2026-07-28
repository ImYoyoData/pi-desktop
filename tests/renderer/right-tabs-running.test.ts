import { describe, expect, it } from "vitest";
import { pinRunningFirst } from "../../src/renderer/src/utils/right-tabs-running";

describe("pinRunningFirst", () => {
  it("moves the first running tab to index 0", () => {
    const tabs = [
      { id: "changes-1", kind: "changes" },
      { id: "running-1", kind: "running" },
      { id: "terminal-1", kind: "terminal" },
    ];
    expect(pinRunningFirst(tabs).map((t) => t.id)).toEqual([
      "running-1",
      "changes-1",
      "terminal-1",
    ]);
  });

  it("leaves order unchanged when running is already first", () => {
    const tabs = [
      { id: "running-1", kind: "running" },
      { id: "changes-1", kind: "changes" },
    ];
    expect(pinRunningFirst(tabs)).toEqual(tabs);
  });

  it("returns input unchanged when no running tab exists", () => {
    const tabs = [
      { id: "changes-1", kind: "changes" },
      { id: "browser-1", kind: "browser" },
    ];
    expect(pinRunningFirst(tabs)).toBe(tabs);
  });

  it("keeps only the first running at front and appends extras", () => {
    const tabs = [
      { id: "changes-1", kind: "changes" },
      { id: "running-1", kind: "running" },
      { id: "running-2", kind: "running" },
    ];
    expect(pinRunningFirst(tabs).map((t) => t.id)).toEqual([
      "running-1",
      "changes-1",
      "running-2",
    ]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectFsRefreshPlan,
  createGitRefreshCoalescer,
  parentDirOf,
} from "../../src/renderer/src/utils/files-fs-events";

describe("parentDirOf", () => {
  it("returns the posix parent", () => {
    expect(parentDirOf("src/renderer/App.tsx")).toBe("src/renderer");
  });

  it("returns an empty string for root entries", () => {
    expect(parentDirOf("README.md")).toBe("");
  });

  it("normalizes windows separators", () => {
    expect(parentDirOf("src\\main\\index.ts")).toBe("src/main");
  });
});

describe("collectFsRefreshPlan", () => {
  it("reloads the visible parent of an added entry", () => {
    const plan = collectFsRefreshPlan([{ path: "src/main/new.ts", kind: "add" }], ["src", "src/main"]);
    expect(plan.reloadDirs).toEqual(["src/main"]);
    expect(plan.collapseDirs).toEqual([]);
  });

  it("ignores entries whose parent is not visible", () => {
    const plan = collectFsRefreshPlan([{ path: "src/main/new.ts", kind: "add" }], ["docs"]);
    expect(plan.reloadDirs).toEqual([]);
  });

  it("always reloads the root for top-level entries", () => {
    const plan = collectFsRefreshPlan([{ path: "package.json", kind: "add" }], []);
    expect(plan.reloadDirs).toEqual([""]);
  });

  it("does not reload anything for content changes", () => {
    const plan = collectFsRefreshPlan([{ path: "src/main/index.ts", kind: "change" }], ["src", "src/main"]);
    expect(plan.reloadDirs).toEqual([]);
  });

  it("collapses a deleted expanded directory and reloads its parent", () => {
    const plan = collectFsRefreshPlan([{ path: "src/gone", kind: "unlink" }], ["src", "src/gone"]);
    expect(plan.collapseDirs).toEqual(["src/gone"]);
    expect(plan.reloadDirs).toEqual(["src"]);
  });

  it("dedupes the reload targets of one batch", () => {
    const plan = collectFsRefreshPlan(
      [
        { path: "src/a.ts", kind: "add" },
        { path: "src/b.ts", kind: "add" },
        { path: "src/c.ts", kind: "unlink" },
      ],
      ["src"],
    );
    expect(plan.reloadDirs).toEqual(["src"]);
  });
});

describe("createGitRefreshCoalescer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses a burst of change events into one refresh", () => {
    const run = vi.fn();
    const coalescer = createGitRefreshCoalescer({ delayMs: 200, run });
    coalescer.schedule();
    coalescer.schedule();
    coalescer.schedule();
    expect(run).not.toHaveBeenCalled();
    expect(coalescer.pending).toBe(true);

    vi.advanceTimersByTime(200);
    expect(run).toHaveBeenCalledTimes(1);
    expect(coalescer.pending).toBe(false);
  });

  it("runs again after the window closes", () => {
    const run = vi.fn();
    const coalescer = createGitRefreshCoalescer({ delayMs: 200, run });
    coalescer.schedule();
    vi.advanceTimersByTime(200);
    coalescer.schedule();
    vi.advanceTimersByTime(200);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("drops the pending refresh when cancelled", () => {
    const run = vi.fn();
    const coalescer = createGitRefreshCoalescer({ delayMs: 200, run });
    coalescer.schedule();
    coalescer.cancel();
    vi.advanceTimersByTime(1_000);
    expect(run).not.toHaveBeenCalled();
    expect(coalescer.pending).toBe(false);
  });
});

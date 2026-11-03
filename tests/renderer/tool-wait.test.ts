import { describe, expect, it } from "vitest";
import { t } from "../../src/renderer/src/i18n";
import type { WaitJob } from "../../src/renderer/src/utils/tool-diff";
import {
  sortWaitJobs,
  waitElapsedMs,
  waitHeadline,
  waitJobCounts,
} from "../../src/renderer/src/utils/tool-wait";

function job(overrides: Partial<WaitJob>): WaitJob {
  return {
    id: "job-1",
    type: "task",
    status: "running",
    label: "job",
    intent: null,
    durationMs: 0,
    exitCode: null,
    completionPercent: null,
    stage: null,
    requests: null,
    cost: null,
    contextTokens: null,
    contextWindow: null,
    model: null,
    resultText: null,
    errorText: null,
    widget: null,
    ...overrides,
    agentId: overrides.agentId ?? null,
  };
}

describe("waitJobCounts", () => {
  it("counts every status", () => {
    const counts = waitJobCounts([
      job({ id: "a" }),
      job({ id: "b", status: "completed" }),
      job({ id: "c", status: "failed" }),
      job({ id: "d", status: "cancelled" }),
    ]);
    expect(counts).toEqual({ running: 1, completed: 1, failed: 1, cancelled: 1 });
  });
});

describe("sortWaitJobs", () => {
  it("puts running jobs first and keeps longer runs ahead", () => {
    const sorted = sortWaitJobs([
      job({ id: "done", status: "completed", durationMs: 90_000 }),
      job({ id: "failed", status: "failed", durationMs: 1_000 }),
      job({ id: "slow", durationMs: 60_000 }),
      job({ id: "fast", durationMs: 5_000 }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual([
      "slow",
      "fast",
      "failed",
      "done",
    ]);
  });
});

describe("waitHeadline", () => {
  it("describes a full wait and a partial wait", () => {
    expect(waitHeadline([job({ id: "a" }), job({ id: "b" })], t, true)).toBe(
      t.toolWaitRunning(2),
    );
    expect(
      waitHeadline([job({ id: "a" }), job({ id: "b", status: "completed" })], t, true),
    ).toBe(t.toolWaitPartial(1, 2));
  });

  it("falls back to pending / finished when nothing is tracked", () => {
    expect(waitHeadline([], t, true)).toBe(t.toolWaitPending);
    expect(waitHeadline([], t, false)).toBe(t.toolWaitFinished);
  });
});

describe("waitElapsedMs", () => {
  it("uses the live clock while streaming and the recorded duration after", () => {
    expect(waitElapsedMs(1_000, null, true, 13_000)).toBe(12_000);
    expect(waitElapsedMs(1_000, 9_000, false, 13_000)).toBe(9_000);
    expect(waitElapsedMs(null, null, true, 13_000)).toBeNull();
  });
});

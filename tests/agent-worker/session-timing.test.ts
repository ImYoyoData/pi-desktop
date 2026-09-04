import { describe, expect, it } from "vitest";
import { SessionTimingTracker } from "../../src/agent-worker/context-usage";
import {
  parseSessionTiming,
  sessionTimingPath,
} from "../../src/shared/session-timing";

describe("session-timing sidecar", () => {
  it("derives the sidecar path from the session file", () => {
    expect(sessionTimingPath("/tmp/sessions/abc.jsonl")).toBe(
      "/tmp/sessions/abc.jsonl.timing.json",
    );
  });

  it("parses a valid persisted payload", () => {
    const timing = parseSessionTiming({
      llmMs: 1200,
      ttftMs: 600,
      ttftSteps: 2,
      decodeMs: 800,
      outputTokens: 100,
    });
    expect(timing).toEqual({
      llmMs: 1200,
      ttftMs: 600,
      ttftSteps: 2,
      decodeMs: 800,
      outputTokens: 100,
    });
  });

  it("rejects corrupt payloads", () => {
    expect(parseSessionTiming(null)).toBeNull();
    expect(parseSessionTiming({})).toBeNull();
    expect(
      parseSessionTiming({
        llmMs: -1,
        ttftMs: 0,
        ttftSteps: 0,
        decodeMs: 0,
        outputTokens: 0,
      }),
    ).toBeNull();
    expect(
      parseSessionTiming({
        llmMs: "x",
        ttftMs: 0,
        ttftSteps: 0,
        decodeMs: 0,
        outputTokens: 0,
      }),
    ).toBeNull();
  });

  it("restore() seeds totals so reopened sessions keep their stats", () => {
    const tracker = new SessionTimingTracker();
    tracker.restore({
      llmMs: 10_000,
      ttftMs: 900,
      ttftSteps: 3,
      decodeMs: 5_000,
      outputTokens: 250,
    });
    const snap = tracker.snapshot();
    expect(snap.llmMs).toBe(10_000);
    expect(snap.ttftMs).toBe(900);
    expect(snap.ttftSteps).toBe(3);
    expect(snap.decodeMs).toBe(5_000);
    expect(snap.outputTokens).toBe(250);
    tracker.observe({ type: "turn_start" });
    tracker.observe({
      type: "message_end",
      message: { role: "assistant", usage: { output: 10 } },
    });
    expect(tracker.snapshot().ttftSteps).toBe(3);
    expect(tracker.snapshot().outputTokens).toBe(250);
    expect(tracker.snapshot().llmMs).toBeGreaterThanOrEqual(10_000);
  });
});

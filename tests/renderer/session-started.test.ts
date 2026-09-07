import { describe, expect, it } from "vitest";
import type { SessionSummary } from "../../src/shared/protocol";
import { isUnstartedSession } from "../../src/renderer/src/utils/session-started";

function summary(over: Partial<SessionSummary>): SessionSummary {
  return {
    id: "s1",
    filePath: "/tmp/s1.jsonl",
    cwd: "/tmp",
    modified: "2026-01-01T00:00:00.000Z",
    status: "idle",
    ...over,
  };
}

describe("isUnstartedSession", () => {
  it("returns true for a brand-new session with no name and no messages", () => {
    expect(
      isUnstartedSession(
        summary({ firstMessage: "(no messages)", name: undefined }),
      ),
    ).toBe(true);
    expect(isUnstartedSession(summary({ firstMessage: undefined }))).toBe(true);
    expect(isUnstartedSession(summary({ firstMessage: "" }))).toBe(true);
  });

  it("returns false once a first user message exists", () => {
    expect(
      isUnstartedSession(summary({ firstMessage: "hello", name: undefined })),
    ).toBe(false);
    expect(
      isUnstartedSession(
        summary({ firstMessage: "hello", name: "auto title" }),
      ),
    ).toBe(false);
  });

  it("keeps sessions the user explicitly named", () => {
    expect(
      isUnstartedSession(
        summary({ firstMessage: "(no messages)", name: "my notes" }),
      ),
    ).toBe(false);
  });

  it("never deletes a running session", () => {
    expect(
      isUnstartedSession(
        summary({ firstMessage: "(no messages)", status: "running" }),
      ),
    ).toBe(false);
  });

  it("returns false for null/undefined rows", () => {
    expect(isUnstartedSession(null)).toBe(false);
    expect(isUnstartedSession(undefined)).toBe(false);
  });
});

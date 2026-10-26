import { describe, expect, it } from "vitest";
import {
  bumpSessionRanks,
  compareSessionsOf,
  renumberSessionRanks,
  sessionRankOf,
  type SessionRanks,
} from "../../src/renderer/src/utils/session-order";
import type { SessionSummary } from "../../src/shared/protocol";

const ROOT = "/w";

function s(
  id: string,
  modified: string,
  status: SessionSummary["status"] = "idle",
): SessionSummary {
  return {
    id,
    filePath: `${ROOT}/${id}.jsonl`,
    cwd: ROOT,
    modified,
    status,
  };
}

const orderOf = (
  sessions: SessionSummary[],
  ranks: SessionRanks,
  pins: Record<string, string[]> = {},
): string[] =>
  [...sessions]
    .sort(compareSessionsOf(ranks, pins, ROOT, "recent"))
    .map((row) => row.id);

describe("session order", () => {
  it("falls back to modified when a session has no rank", () => {
    const rows = [s("a", "2026-01-01T00:00:00.000Z"), s("b", "2026-01-02T00:00:00.000Z")];
    expect(orderOf(rows, {})).toEqual(["b", "a"]);
    expect(sessionRankOf(rows[0]!, undefined, "recent")).toBe(
      Date.parse("2026-01-01T00:00:00.000Z"),
    );
  });

  it("keeps running sessions above finished ones", () => {
    const rows = [
      s("done", "2026-01-02T00:00:00.000Z"),
      s("live", "2026-01-01T00:00:00.000Z", "running"),
    ];
    expect(orderOf(rows, {})).toEqual(["live", "done"]);
  });

  it("bumps sessions to the front in the given order", () => {
    const rows = [s("a", "2026-01-01T00:00:00.000Z"), s("b", "2026-01-02T00:00:00.000Z")];
    const ranks = bumpSessionRanks({}, ROOT, ["a", "b"], 1_800_000_000_000);
    expect(orderOf(rows, ranks)).toEqual(["a", "b"]);
    expect(
      orderOf(rows, bumpSessionRanks(ranks, ROOT, ["b"], 1_800_000_001_000)),
    ).toEqual(["b", "a"]);
  });

  it("keeps pinned sessions first regardless of rank", () => {
    const rows = [s("a", "2026-01-01T00:00:00.000Z"), s("b", "2026-01-02T00:00:00.000Z")];
    const ranks = bumpSessionRanks({}, ROOT, ["a"], 1_800_000_000_000);
    expect(orderOf(rows, ranks, { [ROOT]: ["b"] })).toEqual(["b", "a"]);
  });

  it("renumbering keeps dragged order and leaves unlisted sessions after it", () => {
    const rows = [
      s("a", "2026-01-01T00:00:00.000Z"),
      s("b", "2026-01-02T00:00:00.000Z"),
      s("c", "2026-01-03T00:00:00.000Z"),
    ];
    const before = bumpSessionRanks({}, ROOT, ["c", "b", "a"], 1_800_000_000_000);
    const after = renumberSessionRanks(before, ROOT, ["a", "c", "b"], 1_800_000_002_000);
    expect(orderOf(rows, after)).toEqual(["a", "c", "b"]);
  });

  it("renumbering keeps sessions missing from the list below the dragged ones", () => {
    const rows = [
      s("a", "2026-01-01T00:00:00.000Z"),
      s("b", "2026-01-02T00:00:00.000Z"),
    ];
    const before = bumpSessionRanks({}, ROOT, ["b", "a"], 1_800_000_000_000);
    const after = renumberSessionRanks(before, ROOT, ["a"], 1_800_000_002_000);
    expect(orderOf(rows, after)).toEqual(["a", "b"]);
  });
});

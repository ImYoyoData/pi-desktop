import { describe, expect, it } from "vitest";
import {
  applyConflictChoices,
  parseConflictMarkers,
  previewConflictContent,
} from "../../src/renderer/src/utils/conflict-markers";

describe("conflict-markers", () => {
  it("parses multiple conflict blocks with surrounding text", () => {
    const input = [
      "head",
      "<<<<<<< HEAD",
      "a",
      "=======",
      "b",
      ">>>>>>> branch",
      "mid",
      "<<<<<<< HEAD",
      "c",
      "=======",
      "d",
      ">>>>>>> branch",
      "tail",
      "",
    ].join("\n");
    const parsed = parseConflictMarkers(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.segments.filter((s) => s.kind === "conflict")).toHaveLength(2);
    expect(applyConflictChoices(parsed.segments, { 0: "ours", 1: "theirs" })).toBe(
      ["head", "a", "mid", "d", "tail", ""].join("\n"),
    );
  });

  it("returns no_markers when file has no conflict markers", () => {
    const parsed = parseConflictMarkers("plain\n");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toBe("no_markers");
  });

  it("returns malformed when separator missing", () => {
    const input = "<<<<<<< HEAD\nonly\n>>>>>>> x\n";
    const parsed = parseConflictMarkers(input);
    expect(parsed).toEqual({ ok: false, reason: "malformed" });
  });

  it("ignores diff3 base section between ||||||| and =======", () => {
    const input = [
      "<<<<<<< HEAD",
      "ours",
      "||||||| merged common",
      "base",
      "=======",
      "theirs",
      ">>>>>>> branch",
      "",
    ].join("\n");
    const parsed = parseConflictMarkers(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const c = parsed.segments.find((s) => s.kind === "conflict");
    expect(c && c.kind === "conflict" && c.ours).toBe("ours\n");
    expect(c && c.kind === "conflict" && c.theirs).toBe("theirs\n");
  });

  it("preview keeps markers for unset choices", () => {
    const input = ["<<<<<<< H", "o", "=======", "t", ">>>>>>> B", ""].join("\n");
    const parsed = parseConflictMarkers(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const preview = previewConflictContent(parsed.segments, { 0: "unset" });
    expect(preview).toContain("<<<<<<<");
    expect(preview).toContain("=======");
  });
});

import { describe, expect, it } from "vitest";
import {
  tokenizeForDiff,
  wordDiff,
  WORD_DIFF_MAX_TOKENS,
} from "../../src/renderer/src/utils/word-diff";

describe("tokenizeForDiff", () => {
  it("keeps whitespace as its own token", () => {
    expect(tokenizeForDiff("a b")).toEqual(["a", " ", "b"]);
  });

  it("drops empty fragments", () => {
    expect(tokenizeForDiff("  ")).toEqual(["  "]);
  });
});

describe("wordDiff", () => {
  it("marks the changed word on both sides", () => {
    const result = wordDiff(
      '    if (card.kind === "bash") {',
      '    if (card.kind === "read") return card.preview;',
    );
    const changedOld = result.old
      .filter((part) => part.changed)
      .map((part) => part.text)
      .join("");
    const changedNew = result.new
      .filter((part) => part.changed)
      .map((part) => part.text)
      .join("");
    expect(changedOld).toContain("bash");
    expect(changedNew).toContain("read");
    expect(changedNew).toContain("return");
  });

  it("leaves identical lines untouched", () => {
    const result = wordDiff("  return card.diff;", "  return card.diff;");
    expect(result.old.every((part) => !part.changed)).toBe(true);
    expect(result.new.every((part) => !part.changed)).toBe(true);
  });

  it("reconstructs both sides exactly", () => {
    const oldText = "  const x = 1;";
    const newText = "  const y = 2;";
    expect(wordDiff(oldText, newText).old.map((p) => p.text).join("")).toBe(oldText);
    expect(wordDiff(oldText, newText).new.map((p) => p.text).join("")).toBe(newText);
  });

  it("marks everything when the two lines share nothing", () => {
    const result = wordDiff("alpha", "beta");
    expect(result.old.every((part) => part.changed)).toBe(true);
    expect(result.new.every((part) => part.changed)).toBe(true);
  });

  it("degrades to whole-line marking when a side is over the token limit", () => {
    const long = Array.from({ length: WORD_DIFF_MAX_TOKENS + 1 }, (_, i) => `t${i}`).join(" ");
    const result = wordDiff(long, "short");
    expect(result.old.every((part) => part.changed)).toBe(true);
    expect(result.new.every((part) => part.changed)).toBe(true);
  });
});

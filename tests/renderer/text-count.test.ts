import { describe, expect, it } from "vitest";
import {
  countChars,
  createCharCounter,
} from "../../src/renderer/src/utils/text-count";

describe("countChars", () => {
  it("ignores whitespace", () => {
    expect(countChars(" 你好 \n\t世界　！\u00a0")).toBe(5);
  });

  it("counts text without blanks", () => {
    expect(countChars("Hello world")).toBe(10);
  });

  it("counts grapheme clusters as one character", () => {
    expect(countChars("👨‍👩‍👧‍👦 é")).toBe(2);
  });

  it("returns zero for blank text", () => {
    expect(countChars(" \n\t\u3000")).toBe(0);
  });
});

describe("createCharCounter", () => {
  it("adds only the appended segment", () => {
    const count = createCharCounter();
    expect(count("你 好")).toBe(2);
    expect(count("你 好，世界")).toBe(5);
  });

  it("recounts when the text changes", () => {
    const count = createCharCounter();
    expect(count("abc def")).toBe(6);
    expect(count("ab")).toBe(2);
  });
});

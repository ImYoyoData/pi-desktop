import { describe, expect, it } from "vitest";
import { matchWakeWords, parseWakeWords } from "../../src/shared/asr-wake";

describe("asr-wake", () => {
  it("parses comma and newlines", () => {
    expect(parseWakeWords("小皮, hey pi\n唤醒")).toEqual(["小皮", "hey pi", "唤醒"]);
  });

  it("matches case-insensitive substring", () => {
    expect(matchWakeWords("Okay Hey PI please", ["hey pi"])).toBe("hey pi");
    expect(matchWakeWords("你好小皮在吗", ["小皮"])).toBe("小皮");
    expect(matchWakeWords("hello", ["小皮"])).toBeNull();
  });
});

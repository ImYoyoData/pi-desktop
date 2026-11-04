import { describe, expect, it } from "vitest";
import {
  clampThinkingLevel,
  declaredThinkingLevels,
  supportedThinkingLevels,
  type ThinkingLevel,
} from "../../src/shared/thinking-level";

const DEFAULT_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];

describe("thinking level semantics", () => {
  it("matches Pi SDK supported levels", () => {
    expect(supportedThinkingLevels({ reasoning: false })).toEqual(["off"]);
    expect(supportedThinkingLevels({ reasoning: true })).toEqual(DEFAULT_LEVELS);
    expect(supportedThinkingLevels({ reasoning: true, thinkingLevelMap: {} })).toEqual(
      DEFAULT_LEVELS,
    );
    expect(
      supportedThinkingLevels({
        reasoning: true,
        thinkingLevelMap: { low: null, xhigh: null, max: null },
      }),
    ).toEqual(["off", "minimal", "medium", "high"]);
    expect(
      supportedThinkingLevels({
        reasoning: true,
        thinkingLevelMap: { xhigh: "xhigh", max: "max" },
      }),
    ).toEqual([...DEFAULT_LEVELS, "xhigh", "max"]);
    expect(
      supportedThinkingLevels({ reasoning: true, thinkingLevelMap: { off: null } }),
    ).toEqual(["minimal", "low", "medium", "high"]);
  });

  it("distinguishes an unconfigured map from a configured one", () => {
    expect(declaredThinkingLevels(undefined)).toBeUndefined();
    expect(declaredThinkingLevels({})).toBeUndefined();
    expect(declaredThinkingLevels({ unrelated: null })).toBeUndefined();
    expect(declaredThinkingLevels({ low: null })).toEqual([
      "off",
      "minimal",
      "medium",
      "high",
    ]);
  });

  it("clamps like the SDK before choosing a level", () => {
    expect(clampThinkingLevel("max", DEFAULT_LEVELS)).toBe("high");
    expect(clampThinkingLevel("off", ["minimal", "low", "high"])).toBe("minimal");
    expect(clampThinkingLevel("low", ["low", "high"])).toBe("low");
    expect(clampThinkingLevel("medium", ["high"])).toBe("high");
    expect(clampThinkingLevel("medium", [])).toBe("off");
  });
});

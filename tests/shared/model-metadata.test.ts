import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  guessContextWindow,
  resolveContextWindow,
  resolveMaxTokens,
} from "../../src/shared/model-metadata";

describe("model metadata defaults", () => {
  it("uses a 32K max-output budget by default", () => {
    expect(DEFAULT_MAX_TOKENS).toBe(32_768);
    expect(resolveMaxTokens(undefined)).toBe(32_768);
    expect(resolveMaxTokens(0)).toBe(32_768);
    expect(resolveMaxTokens(Number.NaN)).toBe(32_768);
    expect(DEFAULT_CONTEXT_WINDOW).toBe(128_000);
  });

  it("prefers a budget reported by the provider", () => {
    expect(resolveMaxTokens(64_000)).toBe(64_000);
    expect(resolveMaxTokens(1_024.7)).toBe(1_024);
  });

  it("keeps a reported context window over the heuristic", () => {
    expect(resolveContextWindow(262_144, "claude-fable-5")).toBe(262_144);
    expect(resolveContextWindow(undefined, "claude-fable-5")).toBe(1_000_000);
    expect(resolveContextWindow(null, "totally-unknown")).toBeUndefined();
  });

  it("guesses well-known model families", () => {
    expect(guessContextWindow("gemini-3.6-flash")).toBe(1_048_576);
    expect(guessContextWindow("claude-sonnet-4-6")).toBe(200_000);
    expect(guessContextWindow("gpt-5.5")).toBe(400_000);
    expect(guessContextWindow("deepseek-v4-flash")).toBe(1_000_000);
    expect(guessContextWindow("moonshotai/Kimi-K3")).toBe(1_000_000);
    expect(guessContextWindow("qwen3.7-max")).toBe(1_000_000);
    expect(guessContextWindow("MiniMax-M3")).toBe(1_000_000);
    expect(guessContextWindow("xiaomi/mimo-v2.5-pro")).toBe(1_000_000);
    expect(guessContextWindow("grok-4.6")).toBe(500_000);
    expect(guessContextWindow("meituan/LongCat-2.0:free")).toBe(1_048_576);
    expect(guessContextWindow("")).toBeUndefined();
  });
});

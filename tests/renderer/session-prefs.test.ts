import { describe, expect, it } from "vitest";
import {
  DRAFT_PREF_KEY,
  SESSION_PREFS_KEY,
  EMPTY_SESSION_PREFS,
  flatModelOptions,
  forgetPrefKey,
  modelKeyFromState,
  parseSessionPrefs,
  resolveThinkingResult,
  serializeSessionPrefs,
  setPrefKey,
  thinkingFromState,
} from "../../src/renderer/src/utils/session-prefs";
import type { ThinkingLevel } from "../../src/shared/thinking-level";

const isThinkingLevel = (v: unknown): v is ThinkingLevel =>
  v === "off" || v === "low" || v === "medium" || v === "high";

describe("prefs keys", () => {
  it("are stable constants", () => {
    expect(SESSION_PREFS_KEY).toBe("pi-desktop:session-model-prefs");
    expect(DRAFT_PREF_KEY).toBe("__draft__");
  });
});

describe("parseSessionPrefs", () => {
  it("falls back to empty for null and malformed input", () => {
    expect(parseSessionPrefs(null)).toEqual(EMPTY_SESSION_PREFS);
    expect(parseSessionPrefs("{oops")).toEqual(EMPTY_SESSION_PREFS);
    expect(parseSessionPrefs("[]")).toEqual(EMPTY_SESSION_PREFS);
  });

  it("ignores non-object fields", () => {
    expect(parseSessionPrefs('{"models":3,"thinking":"x"}')).toEqual(EMPTY_SESSION_PREFS);
  });

  it("keeps well-formed fields", () => {
    const raw = JSON.stringify({ models: { s1: "a/b" }, thinking: { s1: "high" } });
    expect(parseSessionPrefs(raw)).toEqual({
      models: { s1: "a/b" },
      thinking: { s1: "high" },
    });
  });
});

describe("serializeSessionPrefs", () => {
  it("round-trips through parse", () => {
    const prefs = { models: { s1: "a/b" }, thinking: { s1: "medium" as const } };
    expect(parseSessionPrefs(serializeSessionPrefs(prefs))).toEqual(prefs);
  });
});

describe("setPrefKey", () => {
  it("returns the same reference when the value is unchanged", () => {
    const prefs = { models: { s1: "a/b" }, thinking: {} };
    expect(setPrefKey(prefs, "models", "s1", "a/b")).toBe(prefs);
  });

  it("updates immutably", () => {
    const prefs = { models: { s1: "a/b" }, thinking: {} };
    const next = setPrefKey(prefs, "models", "s2", "c/d");
    expect(next.models).toEqual({ s1: "a/b", s2: "c/d" });
    expect(prefs.models).toEqual({ s1: "a/b" });
  });
});

describe("forgetPrefKey", () => {
  it("returns the same reference for an absent key", () => {
    const prefs = { models: {}, thinking: {} };
    expect(forgetPrefKey(prefs, "nope")).toBe(prefs);
  });

  it("removes the key from both fields", () => {
    const prefs = {
      models: { s1: "a/b" },
      thinking: { s1: "high" as const },
    };
    expect(forgetPrefKey(prefs, "s1")).toEqual({ models: {}, thinking: {} });
  });
});

describe("modelKeyFromState", () => {
  it("extracts provider/id", () => {
    expect(modelKeyFromState({ model: { provider: "a", id: "b" } })).toBe("a/b");
  });

  it("returns null for missing or malformed shapes", () => {
    expect(modelKeyFromState(null)).toBeNull();
    expect(modelKeyFromState({})).toBeNull();
    expect(modelKeyFromState({ model: null })).toBeNull();
    expect(modelKeyFromState({ model: { provider: "a" } })).toBeNull();
    expect(modelKeyFromState({ model: { provider: 1, id: "b" } })).toBeNull();
    expect(modelKeyFromState({ model: { provider: "", id: "" } })).toBeNull();
  });
});

describe("thinkingFromState", () => {
  it("keeps valid levels and rejects others", () => {
    expect(thinkingFromState({ thinkingLevel: "high" }, isThinkingLevel)).toBe("high");
    expect(thinkingFromState({ thinkingLevel: "nope" }, isThinkingLevel)).toBeNull();
    expect(thinkingFromState({}, isThinkingLevel)).toBeNull();
  });
});

describe("resolveThinkingResult", () => {
  it("reports no clamp when the worker echoes the request", () => {
    expect(resolveThinkingResult("high", { level: "high" }, isThinkingLevel)).toEqual({
      actual: "high",
      clamped: false,
    });
  });

  it("reports no clamp when the worker returns nothing usable", () => {
    expect(resolveThinkingResult("high", null, isThinkingLevel)).toEqual({
      actual: "high",
      clamped: false,
    });
    expect(resolveThinkingResult("high", { level: 9 }, isThinkingLevel)).toEqual({
      actual: "high",
      clamped: false,
    });
  });

  it("reports the clamped level when it differs", () => {
    expect(resolveThinkingResult("max", { level: "high" }, isThinkingLevel)).toEqual({
      actual: "high",
      clamped: true,
    });
  });
});

describe("flatModelOptions", () => {
  it("flattens groups and passes through leaves", () => {
    const groups = [
      { type: "group" as const, label: "G", key: "g", children: [{ label: "a", value: "a" }] },
      { label: "b", value: "b" },
    ];
    expect(flatModelOptions(groups)).toEqual([
      { label: "a", value: "a" },
      { label: "b", value: "b" },
    ]);
  });

  it("returns empty for no groups", () => {
    expect(flatModelOptions([])).toEqual([]);
  });
});
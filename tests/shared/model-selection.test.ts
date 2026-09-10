import { describe, expect, it } from "vitest";
import {
  EMPTY_MODEL_SELECTION,
  filterAvailableModels,
  isProviderCurated,
  parseModelSelection,
  providerSelection,
  pruneModelSelection,
  withProviderSelection,
} from "../../src/shared/model-selection";

const AVAILABLE = [
  { provider: "openrouter", id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5" },
  { provider: "openrouter", id: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash" },
  { provider: "openrouter", id: "xai/grok-4.6", name: "Grok 4.6" },
  { provider: "deepseek", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
];

describe("model selection", () => {
  it("passes every model through when nothing is curated", () => {
    const selection = { ...EMPTY_MODEL_SELECTION, providers: {} };
    expect(filterAvailableModels(AVAILABLE, selection)).toHaveLength(4);
    expect(isProviderCurated(selection, "openrouter")).toBe(false);
    expect(providerSelection(selection, "openrouter")).toBeNull();
  });

  it("narrows a curated provider and leaves the others alone", () => {
    const selection = withProviderSelection(EMPTY_MODEL_SELECTION, "openrouter", [
      "xai/grok-4.6",
      "google/gemini-3.8-flash",
    ]);
    const filtered = filterAvailableModels(AVAILABLE, selection);
    // openrouter is trimmed to the two curated ids; deepseek passes through.
    expect(filtered).toEqual([
      { provider: "openrouter", id: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash" },
      { provider: "openrouter", id: "xai/grok-4.6", name: "Grok 4.6" },
      { provider: "deepseek", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    ]);
    expect(isProviderCurated(selection, "openrouter")).toBe(true);
    expect(isProviderCurated(selection, "deepseek")).toBe(false);
  });

  it("treats an empty curated list as 'hide this provider'", () => {
    const selection = withProviderSelection(EMPTY_MODEL_SELECTION, "openrouter", []);
    expect(isProviderCurated(selection, "openrouter")).toBe(true);
    expect(providerSelection(selection, "openrouter")).toEqual([]);
    expect(filterAvailableModels(AVAILABLE, selection).map((m) => m.provider)).toEqual([
      "deepseek",
    ]);
  });

  it("resets a provider back to uncurated with null", () => {
    const curated = withProviderSelection(EMPTY_MODEL_SELECTION, "openrouter", ["xai/grok-4.6"]);
    const reset = withProviderSelection(curated, "openrouter", null);
    expect(isProviderCurated(reset, "openrouter")).toBe(false);
    expect(filterAvailableModels(AVAILABLE, reset)).toHaveLength(4);
  });

  it("dedupes and trims ids", () => {
    const selection = withProviderSelection(EMPTY_MODEL_SELECTION, "openrouter", [
      "  xai/grok-4.6  ",
      "xai/grok-4.6",
      "",
      "google/gemini-3.8-flash",
    ]);
    expect(providerSelection(selection, "openrouter")).toEqual([
      "xai/grok-4.6",
      "google/gemini-3.8-flash",
    ]);
  });

  it("keeps the catalog's own order inside a curated provider", () => {
    const selection = withProviderSelection(EMPTY_MODEL_SELECTION, "openrouter", [
      "xai/grok-4.6",
      "anthropic/claude-sonnet-5",
    ]);
    // Filtering is order-preserving: the panel decides how to present it.
    expect(filterAvailableModels(AVAILABLE, selection).map((m) => m.id)).toEqual([
      "anthropic/claude-sonnet-5",
      "xai/grok-4.6",
      "deepseek-v4-flash",
    ]);
  });

  it("drops curated ids that no longer exist upstream", () => {
    const selection = withProviderSelection(EMPTY_MODEL_SELECTION, "openrouter", [
      "xai/grok-4.6",
      "gone/model",
    ]);
    const pruned = pruneModelSelection(selection, AVAILABLE);
    expect(providerSelection(pruned, "openrouter")).toEqual(["xai/grok-4.6"]);
    // The stale id is gone from the result entirely.
    expect(
      filterAvailableModels(AVAILABLE, pruned).some((m) => m.id === "gone/model"),
    ).toBe(false);
  });

  it("parses junk on disk into a valid selection", () => {
    expect(parseModelSelection(null)).toEqual({ providers: {} });
    expect(parseModelSelection({ providers: "nope" })).toEqual({ providers: {} });
    expect(
      parseModelSelection({
        providers: {
          a: ["m1", "m1", 7, "", " m2 "],
          b: "not-an-array",
          "": ["x"],
        },
      }),
    ).toEqual({ providers: { a: ["m1", "m2"] } });
  });

  it("round-trips through JSON", () => {
    const selection = withProviderSelection(EMPTY_MODEL_SELECTION, "openrouter", ["xai/grok-4.6"]);
    expect(parseModelSelection(JSON.parse(JSON.stringify(selection)))).toEqual(selection);
  });

  it("keeps a curated-to-nothing provider across a prune when it still exists", () => {
    const selection = withProviderSelection(EMPTY_MODEL_SELECTION, "deepseek", []);
    expect(providerSelection(pruneModelSelection(selection, AVAILABLE), "deepseek")).toEqual([]);
  });
});

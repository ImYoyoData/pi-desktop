import { describe, expect, it } from "vitest";
import {
  applyProviderModelOverrides,
  draftToProviderJson,
  emptyCustomProvider,
  listEditableProviders,
  listProviderModelOverrides,
  mergeDiscoveredIntoDraft,
  newModelEntry,
  parseBulkModelTokens,
  parseModelsConfigText,
  shouldStoreApiKeyInModelsJson,
  stringifyModelsConfig,
  upsertCustomProvider,
  validateCustomProvider,
} from "../../src/shared/custom-models";
import { DEFAULT_MAX_TOKENS } from "../../src/shared/model-metadata";
import { findCustomPlatform } from "../../src/shared/provider-catalog";

describe("custom-models helpers", () => {
  it("parses and lists editable providers", () => {
    const text = JSON.stringify({
      providers: {
        ollama: {
          baseUrl: "http://localhost:11434/v1",
          api: "openai-completions",
          apiKey: "ollama",
          models: [{ id: "llama3.1:8b", name: "Llama" }],
        },
      },
    });
    const doc = parseModelsConfigText(text);
    const list = listEditableProviders(doc);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("ollama");
    expect(list[0]?.models[0]?.id).toBe("llama3.1:8b");
  });

  it("preserves top-level keys and unknown provider fields on upsert", () => {
    const doc = parseModelsConfigText(
      JSON.stringify({
        modelOverrides: { openai: { "gpt-x": { contextWindow: 272000 } } },
        providers: {
          longcat: {
            baseUrl: "https://api.longcat.chat/openai/v1",
            api: "openai-completions",
            headers: { "X-Custom": "1" },
            models: [
              {
                id: "LongCat-2.0",
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                thinkingLevelMap: { off: null },
              },
            ],
          },
        },
      }),
    );
    const next = upsertCustomProvider(
      doc,
      emptyCustomProvider({
        id: "longcat",
        name: "LongCat",
        baseUrl: "https://api.longcat.chat/openai/v1",
        apiKey: "sk-secret",
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        models: [
          {
            id: "LongCat-2.0",
            name: "LongCat 2.0",
            reasoning: false,
            contextWindow: 1_000_000,
            maxTokens: 128_000,
          },
        ],
      }),
    );
    const text = stringifyModelsConfig(next);
    const parsed = JSON.parse(text) as {
      modelOverrides: unknown;
      providers: { longcat: Record<string, unknown> };
    };
    expect(parsed.modelOverrides).toBeTruthy();
    expect(parsed.providers.longcat.headers).toEqual({ "X-Custom": "1" });
    const models = parsed.providers.longcat.models as Array<Record<string, unknown>>;
    expect(models[0]?.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(models[0]?.thinkingLevelMap).toEqual({ off: null });
    expect(models[0]?.contextWindow).toBe(1_000_000);
    // Remote secret must not be inlined into models.json
    expect(parsed.providers.longcat.apiKey).toBeUndefined();
  });

  it("keeps local placeholder keys in models.json", () => {
    expect(shouldStoreApiKeyInModelsJson("ollama", "http://localhost:11434/v1")).toBe(true);
    expect(shouldStoreApiKeyInModelsJson("$MY_KEY", "https://api.example.com/v1")).toBe(true);
    expect(shouldStoreApiKeyInModelsJson("sk-live", "https://api.longcat.chat/openai/v1")).toBe(
      false,
    );
    const json = draftToProviderJson(
      emptyCustomProvider({
        id: "ollama",
        baseUrl: "http://localhost:11434/v1",
        apiKey: "ollama",
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        models: [{ id: "m", name: "", reasoning: false }],
      }),
    );
    expect(json.apiKey).toBe("ollama");
  });

  it("validates required fields", () => {
    expect(validateCustomProvider(emptyCustomProvider({ id: "" }))).toMatch(/Provider ID/i);
    expect(
      validateCustomProvider(
        emptyCustomProvider({
          id: "ollama",
          baseUrl: "http://localhost:11434/v1",
          models: [{ id: "m1", name: "", reasoning: false }],
        }),
      ),
    ).toBeNull();
  });

  it("merges discovered models without wiping manual rows", () => {
    const merged = mergeDiscoveredIntoDraft(
      [{ id: "keep-me", name: "Keep", reasoning: true, contextWindow: 8_000 }],
      [
        { id: "keep-me", contextWindow: 16_000 },
        { id: "new-one", name: "New" },
      ],
    );
    expect(merged.find((m) => m.id === "keep-me")).toMatchObject({
      name: "Keep",
      reasoning: true,
      contextWindow: 16_000,
    });
    expect(merged.find((m) => m.id === "new-one")?.name).toBe("New");
  });

  it("defaults a new or discovered model's max output to 32K", () => {
    expect(newModelEntry().maxTokens).toBe(DEFAULT_MAX_TOKENS);
    expect(emptyCustomProvider().models[0]?.maxTokens).toBe(DEFAULT_MAX_TOKENS);
    const merged = mergeDiscoveredIntoDraft([], [{ id: "brand-new" }]);
    expect(merged[0]?.maxTokens).toBe(DEFAULT_MAX_TOKENS);
    // A reported budget wins over the default.
    const reported = mergeDiscoveredIntoDraft([], [{ id: "known", maxTokens: 8_192 }]);
    expect(reported[0]?.maxTokens).toBe(8_192);
  });

  it("carries vision/reasoning flags from discovery into the draft", () => {
    const merged = mergeDiscoveredIntoDraft([], [
      { id: "m", vision: true, reasoning: true, contextWindow: 1_000_000 },
    ]);
    expect(merged[0]).toMatchObject({
      reasoning: true,
      vision: true,
      contextWindow: 1_000_000,
      maxTokens: DEFAULT_MAX_TOKENS,
    });
  });
});

describe("provider model overrides", () => {
  it("writes modelOverrides without touching built-in models", () => {
    const doc = parseModelsConfigText(
      JSON.stringify({
        providers: { opencode: { modelOverrides: { "claude-opus-5": { maxTokens: 4096 } } } },
      }),
    );
    const next = applyProviderModelOverrides(doc, "opencode", {
      "claude-opus-5": { contextWindow: 1_000_000, maxTokens: 32_768 },
      "gpt-5.5": { maxTokens: 32_768, reasoning: true },
    });
    const parsed = JSON.parse(stringifyModelsConfig(next)) as {
      providers: Record<string, Record<string, Record<string, unknown>>>;
    };
    const entry = parsed.providers.opencode!;
    expect(entry.models).toBeUndefined();
    expect(entry.modelOverrides!["claude-opus-5"]).toEqual({
      maxTokens: 32_768,
      contextWindow: 1_000_000,
    });
    expect(entry.modelOverrides!["gpt-5.5"]).toEqual({ maxTokens: 32_768, reasoning: true });
  });

  it("round-trips overrides and keeps unrelated provider fields", () => {
    const doc = parseModelsConfigText(
      JSON.stringify({
        providers: {
          opencode: { baseUrl: "https://opencode.ai/zen", headers: { "X-A": "1" } },
        },
      }),
    );
    const next = applyProviderModelOverrides(doc, "opencode", {
      "kimi-k3": { contextWindow: 1_000_000 },
    });
    expect(listProviderModelOverrides(next, "opencode")).toEqual({
      "kimi-k3": { contextWindow: 1_000_000 },
    });
    const parsed = JSON.parse(stringifyModelsConfig(next)) as {
      providers: Record<string, Record<string, unknown>>;
    };
    expect(parsed.providers.opencode?.baseUrl).toBe("https://opencode.ai/zen");
    expect(parsed.providers.opencode?.headers).toEqual({ "X-A": "1" });
  });

  it("does not list an overrides-only provider as an editable custom provider", () => {
    const doc = applyProviderModelOverrides(parseModelsConfigText("{}"), "openai", {
      "gpt-5.5": { maxTokens: 32_768 },
    });
    expect(listEditableProviders(doc)).toHaveLength(0);
  });
});

describe("bulk model tokens", () => {
  it("splits on newlines, commas, semicolons and bare whitespace", () => {
    expect(parseBulkModelTokens("a\nb,c;d").map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
    expect(parseBulkModelTokens("a b c").map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps spaces in an `ID=Display name` pair", () => {
    expect(parseBulkModelTokens("alpha=Alpha Model")).toEqual([
      { id: "alpha", name: "Alpha Model" },
    ]);
    expect(parseBulkModelTokens("alpha=Alpha Model\nbeta= Beta  Two ")).toEqual([
      { id: "alpha", name: "Alpha Model" },
      { id: "beta", name: "Beta  Two" },
    ]);
  });

  it("mixes both forms and drops duplicates (first wins)", () => {
    expect(parseBulkModelTokens("alpha=Alpha Model\nbeta, gamma\nalpha")).toEqual([
      { id: "alpha", name: "Alpha Model" },
      { id: "beta", name: "" },
      { id: "gamma", name: "" },
    ]);
  });

  it("ignores empty input and stray separators", () => {
    expect(parseBulkModelTokens("")).toEqual([]);
    expect(parseBulkModelTokens("  \n ,, ; \n ")).toEqual([]);
    // A leading `=` has no id, so the whole token stays a plain id.
    expect(parseBulkModelTokens("=name")).toEqual([{ id: "=name", name: "" }]);
  });
});

describe("platform catalog drafts", () => {
  it("ships LongCat with the Pi-aligned OpenAI-compatible endpoint", () => {
    const spec = findCustomPlatform("longcat");
    expect(spec?.id).toBe("longcat");
    expect(spec?.baseUrl).toBe("https://api.longcat.chat/openai/v1");
    expect(spec?.api).toBe("openai-completions");
    expect(spec?.supportsDeveloperRole).toBe(true);
  });

  it("turns a catalog platform into a saveable provider draft", () => {
    const spec = findCustomPlatform("commandcode");
    expect(spec).toBeTruthy();
    const draft = emptyCustomProvider({
      id: spec!.id,
      name: spec!.name,
      baseUrl: spec!.baseUrl,
      api: spec!.api,
      supportsDeveloperRole: spec!.supportsDeveloperRole,
      supportsReasoningEffort: spec!.supportsReasoningEffort,
      models: [newModelEntry({ id: "claude-sonnet-5", contextWindow: 1_000_000 })],
    });
    expect(validateCustomProvider(draft)).toBeNull();
    const json = draftToProviderJson(draft);
    expect(json.baseUrl).toBe("https://api.commandcode.ai/provider/v1");
    const models = json.models as Array<Record<string, unknown>>;
    expect(models[0]).toMatchObject({
      id: "claude-sonnet-5",
      contextWindow: 1_000_000,
      maxTokens: DEFAULT_MAX_TOKENS,
    });
  });
});

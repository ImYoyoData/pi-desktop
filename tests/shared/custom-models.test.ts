import { describe, expect, it } from "vitest";
import {
  draftToProviderJson,
  emptyCustomProvider,
  listEditableProviders,
  mergeDiscoveredIntoDraft,
  parseModelsConfigText,
  shouldStoreApiKeyInModelsJson,
  stringifyModelsConfig,
  upsertCustomProvider,
  validateCustomProvider,
} from "../../src/shared/custom-models";
import { CUSTOM_PROVIDER_PRESETS } from "../../src/shared/custom-model-presets";

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
});

describe("presets", () => {
  it("ships LongCat with Pi-correct baseUrl and context", () => {
    const preset = CUSTOM_PROVIDER_PRESETS.find((p) => p.id === "longcat");
    expect(preset?.draft.baseUrl).toBe("https://api.longcat.chat/openai/v1");
    expect(preset?.draft.models[0]).toMatchObject({
      id: "LongCat-2.0",
      contextWindow: 1_000_000,
      maxTokens: 128_000,
    });
    const anthropic = CUSTOM_PROVIDER_PRESETS.find((p) => p.id === "longcat-anthropic");
    expect(anthropic?.draft.id).toBe("longcat-anthropic");
  });
});

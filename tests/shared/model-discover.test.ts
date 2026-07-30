import { describe, expect, it, vi } from "vitest";
import { discoverModels, normalizeProviderBaseUrl } from "../../src/shared/model-discover";
import { draftToProviderJson, emptyCustomProvider } from "../../src/shared/custom-models";
import { CUSTOM_PROVIDER_PRESETS } from "../../src/shared/custom-model-presets";

describe("normalizeProviderBaseUrl", () => {
  it("strips chat completions suffix and trailing slash", () => {
    expect(normalizeProviderBaseUrl("https://api.longcat.chat/openai/v1/chat/completions")).toBe(
      "https://api.longcat.chat/openai/v1",
    );
    expect(normalizeProviderBaseUrl("https://api.longcat.chat/openai/v1/")).toBe(
      "https://api.longcat.chat/openai/v1",
    );
  });
});

describe("discoverModels", () => {
  it("parses OpenAI /models payload", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          data: [
            { id: "LongCat-2.0", context_window: 1000000, max_tokens: 128000 },
            { id: "other" },
          ],
        }),
    }));
    const result = await discoverModels(
      { baseUrl: "https://api.example.com/v1", apiKey: "k" },
      { fetchImpl: fetchImpl as never },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.models).toHaveLength(2);
    expect(result.models[0]).toMatchObject({
      id: "LongCat-2.0",
      contextWindow: 1_000_000,
      maxTokens: 128_000,
    });
  });

  it("falls back to Ollama /api/tags", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith("/models")) {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          text: async () => "nope",
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () =>
          JSON.stringify({
            models: [{ name: "llama3.1:8b", details: { context_length: 8192 } }],
          }),
      };
    });
    const result = await discoverModels(
      { baseUrl: "http://localhost:11434/v1" },
      { fetchImpl: fetchImpl as never },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.models[0]).toMatchObject({ id: "llama3.1:8b", contextWindow: 8192 });
  });
});

describe("longcat preset", () => {
  it("writes contextWindow into models.json", () => {
    const preset = CUSTOM_PROVIDER_PRESETS.find((p) => p.id === "longcat");
    expect(preset).toBeTruthy();
    const json = draftToProviderJson(preset!.draft);
    expect(json.baseUrl).toBe("https://api.longcat.chat/openai/v1");
    const models = json.models as Array<Record<string, unknown>>;
    expect(models[0]).toMatchObject({
      id: "LongCat-2.0",
      contextWindow: 1_000_000,
      maxTokens: 128_000,
    });
    expect(emptyCustomProvider().models[0]?.contextWindow).toBeUndefined();
  });
});

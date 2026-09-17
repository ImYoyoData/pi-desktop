import { describe, expect, it, vi } from "vitest";
import {
  discoverModels,
  normalizeProviderBaseUrl,
  testModelConnection,
} from "../../src/shared/model-discover";
import { draftToProviderJson, emptyCustomProvider, newModelEntry } from "../../src/shared/custom-models";
import { DEFAULT_MAX_TOKENS } from "../../src/shared/model-metadata";
import { findCustomPlatform } from "../../src/shared/provider-catalog";

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

  it("parses Command Code / OpenRouter style metadata (context_length, top_provider)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          object: "list",
          data: [
            { id: "claude-sonnet-5", name: "Claude Sonnet 5", context_length: 1000000 },
            {
              id: "x/y",
              top_provider: { context_length: 262144, max_completion_tokens: 64000 },
            },
            { id: "vision-model", supports_vision: true },
          ],
        }),
    }));
    const result = await discoverModels(
      { baseUrl: "https://api.commandcode.ai/provider/v1" },
      { fetchImpl: fetchImpl as never },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.models[0]).toMatchObject({
      id: "claude-sonnet-5",
      name: "Claude Sonnet 5",
      contextWindow: 1_000_000,
    });
    expect(result.models[1]).toMatchObject({
      id: "x/y",
      contextWindow: 262_144,
      maxTokens: 64_000,
    });
    expect(result.models[2]?.vision).toBe(true);
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

describe("testModelConnection", () => {
  it("sends a tiny chat completions probe", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: { body?: string }) => {
      expect(init?.body).toContain('"max_tokens":1');
      expect(init?.body).toContain("ping");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      };
    });
    const result = await testModelConnection(
      {
        baseUrl: "https://api.example.com/v1",
        apiKey: "k",
        api: "openai-completions",
        modelId: "demo",
      },
      { fetchImpl: fetchImpl as never },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("requires model id", async () => {
    const result = await testModelConnection({
      baseUrl: "https://api.example.com/v1",
      modelId: "  ",
    });
    expect(result.ok).toBe(false);
  });
});

describe("catalog platform → models.json", () => {
  it("writes discovered limits (and the 32K output default) into the provider entry", () => {
    const spec = findCustomPlatform("longcat");
    expect(spec).toBeTruthy();
    const json = draftToProviderJson(
      emptyCustomProvider({
        id: spec!.id,
        name: spec!.name,
        baseUrl: spec!.baseUrl,
        api: spec!.api,
        models: [
          newModelEntry({ id: "LongCat-2.0", name: "LongCat 2.0", contextWindow: 1_000_000 }),
        ],
      }),
    );
    expect(json.baseUrl).toBe("https://api.longcat.chat/openai/v1");
    const models = json.models as Array<Record<string, unknown>>;
    expect(models[0]).toMatchObject({
      id: "LongCat-2.0",
      contextWindow: 1_000_000,
      maxTokens: DEFAULT_MAX_TOKENS,
    });
    expect(emptyCustomProvider().models[0]?.contextWindow).toBeUndefined();
  });
});

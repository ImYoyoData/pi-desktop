import { describe, expect, it } from "vitest";
import {
  emptyCustomProvider,
  listEditableProviders,
  parseModelsConfigText,
  stringifyModelsConfig,
  upsertCustomProvider,
  validateCustomProvider,
  draftToProviderJson,
} from "../../src/shared/custom-models";

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

  it("upserts provider into models.json text", () => {
    let doc = parseModelsConfigText("{}");
    doc = upsertCustomProvider(
      doc,
      emptyCustomProvider({
        id: "ollama",
        baseUrl: "http://localhost:11434/v1",
        apiKey: "ollama",
        models: [{ id: "qwen2.5", name: "", reasoning: false }],
      }),
    );
    const text = stringifyModelsConfig(doc);
    expect(text).toContain('"ollama"');
    expect(text).toContain("qwen2.5");
    const json = draftToProviderJson(
      emptyCustomProvider({
        id: "x",
        baseUrl: "http://127.0.0.1:1234/v1",
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        models: [{ id: "a", name: "", reasoning: false }],
      }),
    );
    expect(json.compat).toEqual({
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    });
  });
});

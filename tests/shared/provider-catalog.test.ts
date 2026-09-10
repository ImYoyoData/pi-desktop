import { describe, expect, it } from "vitest";
import {
  buildProviderPlatforms,
  CUSTOM_PLATFORMS,
  findCustomPlatform,
  FEATURED_PROVIDER_ORDER,
} from "../../src/shared/provider-catalog";
import type { ModelsProviderAuth } from "../../src/shared/models-settings";

function sdk(partial: Partial<ModelsProviderAuth> & { id: string }): ModelsProviderAuth {
  return {
    displayName: partial.id,
    configured: false,
    modelCount: 0,
    supportsApiKey: true,
    ...partial,
  };
}

const SDK_PROVIDERS: ModelsProviderAuth[] = [
  sdk({ id: "anthropic", displayName: "Anthropic", baseUrl: "https://api.anthropic.com" }),
  sdk({ id: "openai", displayName: "OpenAI", baseUrl: "https://api.openai.com/v1" }),
  sdk({ id: "google", displayName: "Google", baseUrl: "https://generativelanguage.googleapis.com/v1beta" }),
  sdk({ id: "deepseek", displayName: "DeepSeek", baseUrl: "https://api.deepseek.com" }),
  sdk({
    id: "opencode",
    displayName: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen",
    configured: true,
  }),
  sdk({ id: "opencode-go", displayName: "OpenCode Go" }),
  sdk({ id: "zai-coding-cn", displayName: "Z.AI Coding CN" }),
  sdk({ id: "qwen-token-plan-cn", displayName: "Qwen Token Plan CN" }),
  sdk({ id: "moonshotai-cn", displayName: "Moonshot AI CN" }),
  sdk({ id: "minimax-cn", displayName: "MiniMax CN" }),
  sdk({ id: "xiaomi", displayName: "Xiaomi" }),
  sdk({ id: "openrouter", displayName: "OpenRouter" }),
  sdk({ id: "xai", displayName: "xAI" }),
  sdk({ id: "groq", displayName: "Groq" }),
  sdk({ id: "mistral", displayName: "Mistral" }),
  sdk({ id: "together", displayName: "Together" }),
  sdk({ id: "cerebras", displayName: "Cerebras" }),
  sdk({ id: "nvidia", displayName: "NVIDIA" }),
  sdk({ id: "huggingface", displayName: "Hugging Face" }),
  sdk({ id: "vercel-ai-gateway", displayName: "Vercel AI Gateway" }),
  sdk({ id: "github-copilot", displayName: "GitHub Copilot", oauth: true }),
  sdk({ id: "openai-codex", displayName: "OpenAI Codex", supportsApiKey: false, oauth: true }),
  sdk({ id: "radius", displayName: "Radius" }),
];

describe("provider catalog", () => {
  it("ships Command Code with the documented OpenAI-compatible endpoint", () => {
    const spec = findCustomPlatform("commandcode");
    expect(spec).toBeTruthy();
    expect(spec?.baseUrl).toBe("https://api.commandcode.ai/provider/v1");
    expect(spec?.api).toBe("openai-completions");
  });

  it("ships OpenCode Zen via the Pi SDK provider rather than as a custom entry", () => {
    expect(CUSTOM_PLATFORMS.some((p) => p.id === "opencode")).toBe(false);
    const platforms = buildProviderPlatforms({ sdkProviders: SDK_PROVIDERS });
    const opencode = platforms.find((p) => p.providerId === "opencode");
    expect(opencode?.kind).toBe("sdk");
    expect(opencode?.category).toBe("featured");
    expect(opencode?.configured).toBe(true);
  });

  it("keeps every featured id resolvable to a platform", () => {
    const platforms = buildProviderPlatforms({ sdkProviders: SDK_PROVIDERS });
    const ids = new Set(platforms.map((p) => p.providerId));
    for (const id of FEATURED_PROVIDER_ORDER) {
      expect(ids.has(id), `missing featured platform: ${id}`).toBe(true);
    }
  });

  it("orders featured platforms first and puts unknowns in the global group", () => {
    const platforms = buildProviderPlatforms({ sdkProviders: SDK_PROVIDERS });
    expect(platforms[0]?.category).toBe("featured");
    expect(platforms[0]?.providerId).toBe("commandcode");
    expect(platforms.find((p) => p.providerId === "anthropic")?.category).toBe("featured");
    expect(platforms.find((p) => p.providerId === "radius")?.category).toBe("global");
    expect(platforms.find((p) => p.providerId === "opencode-go")?.category).toBe("global");
    // Categories are non-decreasing in rank order.
    const rank = ["featured", "china", "global", "local", "generic"];
    const ranks = platforms.map((p) => rank.indexOf(p.category));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("marks custom platforms already present in models.json as configured", () => {
    const platforms = buildProviderPlatforms({
      sdkProviders: SDK_PROVIDERS,
      customProviderIds: ["ollama", "commandcode"],
    });
    expect(platforms.find((p) => p.providerId === "commandcode")?.configured).toBe(true);
    expect(platforms.find((p) => p.providerId === "ollama")?.configured).toBe(true);
    expect(platforms.find((p) => p.providerId === "lmstudio")?.configured).toBe(false);
  });

  it("exposes OAuth-only providers without an API key path", () => {
    const platforms = buildProviderPlatforms({ sdkProviders: SDK_PROVIDERS });
    const codex = platforms.find((p) => p.providerId === "openai-codex");
    expect(codex?.oauth).toBe(true);
    expect(codex?.hint).toBe("OAuth");
  });

  it("uses verified hosts for every custom platform", () => {
    for (const spec of CUSTOM_PLATFORMS) {
      if (spec.id === "openai-compatible") {
        expect(spec.baseUrl).toBe("");
        continue;
      }
      expect(spec.baseUrl, spec.id).toMatch(/^https?:\/\//u);
      // Never ship a chat-completions suffix as a base URL.
      expect(spec.baseUrl, spec.id).not.toMatch(/\/(chat\/)?completions$/u);
    }
  });

  it("marks local servers as not supporting developer role / reasoning_effort", () => {
    for (const id of ["ollama", "lmstudio", "vllm"]) {
      const spec = findCustomPlatform(id);
      expect(spec?.supportsDeveloperRole, id).toBe(false);
      expect(spec?.supportsReasoningEffort, id).toBe(false);
      expect(spec?.apiKey, id).toBeTruthy();
    }
  });
});

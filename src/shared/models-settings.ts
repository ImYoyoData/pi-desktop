import type { ModelSelection } from "./model-selection";

export type ModelsAvailableEntry = {
  provider: string;
  id: string;
  name: string;
};
export type ModelsProviderAuth = {
  id: string;
  displayName: string;
  configured: boolean;
  source?: string;
  modelCount: number;
  /** Whether this provider accepts API key login via auth.json */
  supportsApiKey: boolean;
  /** Provider endpoint (absent for credentials-only providers such as Bedrock/Vertex). */
  baseUrl?: string;
  /** Provider also exposes an OAuth login flow. */
  oauth?: boolean;
};

/** One entry of a provider's model catalog, with the metadata the GUI cares about. */
export type ProviderCatalogModel = {
  id: string;
  name: string;
  api: string;
  baseUrl: string;
  reasoning: boolean;
  vision: boolean;
  contextWindow: number;
  maxTokens: number;
};

export type ProviderCatalogResult = {
  providerId: string;
  /** Preferred provider-level api (the first model's api). */
  api: string;
  baseUrl: string;
  models: ProviderCatalogModel[];
};

export type ModelsGetResult = {
  modelsText: string;
  /** Legacy map kept for callers; prefer `providers` */
  apiKeyConfigured: Record<string, boolean>;
  /** Built-in + configured providers with real auth status (env / auth.json / oauth) */
  providers: ModelsProviderAuth[];
  /** Full auth-gated catalog. Choosers should narrow this with `modelSelection`. */
  available: ModelsAvailableEntry[];
  /** Desktop-side per-provider curation; absent provider = show everything. */
  modelSelection?: ModelSelection;
};

export type ModelsSetPayload = {
  modelsText: string;
  apiKeys?: Record<string, string>;
  /**
   * Provider ids whose auth.json entry must be dropped: models.json is the
   * source of truth for custom providers, and Pi prefers a stored credential
   * over the inline `apiKey`.
   */
  clearAuth?: string[];
};

/** Prompt the OAuth flow asks the renderer to answer. */
export type ModelsOAuthPrompt =
  | { type: "text" | "secret" | "manual_code"; message: string; placeholder?: string }
  | {
      type: "select";
      message: string;
      options: { id: string; label: string; description?: string }[];
    };

/** Progress pushed to the renderer while a provider login is running. */
export type ModelsOAuthEvent =
  | { type: "info"; message: string; links?: { url: string; label?: string }[] }
  | { type: "auth_url"; url: string; instructions?: string }
  | {
      type: "device_code";
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | { type: "progress"; message: string }
  | { type: "prompt"; promptId: number; prompt: ModelsOAuthPrompt };

export type ModelsOAuthEventPayload = {
  providerId: string;
  event: ModelsOAuthEvent;
};

export type ModelsOAuthPromptReply = {
  providerId: string;
  promptId: number;
  value?: string;
  cancelled?: boolean;
};

/** @deprecated Unused for listing — providers come from Pi SDK ModelRuntime.getProviders() */
export const COMMON_API_KEY_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "deepseek",
  "groq",
  "mistral",
  "moonshotai",
  "openrouter",
  "xai",
  "xiaomi",
  "zhipu",
  "qwen",
  "minimax",
] as const;

export type CommonApiKeyProvider = (typeof COMMON_API_KEY_PROVIDERS)[number];

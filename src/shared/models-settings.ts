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

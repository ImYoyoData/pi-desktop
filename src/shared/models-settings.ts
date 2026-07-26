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
};

export type ModelsGetResult = {
  modelsText: string;
  /** Legacy map kept for callers; prefer `providers` */
  apiKeyConfigured: Record<string, boolean>;
  /** Built-in + configured providers with real auth status (env / auth.json / oauth) */
  providers: ModelsProviderAuth[];
  available: ModelsAvailableEntry[];
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

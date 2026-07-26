export type ModelsAvailableEntry = {
  provider: string;
  id: string;
  name: string;
};

export type ModelsGetResult = {
  modelsText: string;
  apiKeyConfigured: Record<string, boolean>;
  available: ModelsAvailableEntry[];
};

export type ModelsSetPayload = {
  modelsText: string;
  apiKeys?: Record<string, string>;
};

export const COMMON_API_KEY_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "deepseek",
] as const;

export type CommonApiKeyProvider = (typeof COMMON_API_KEY_PROVIDERS)[number];

/** Built-in presets for the custom models form (Pi models.json aligned). */

import type { CustomProviderDraft } from "./custom-models";
import { emptyCustomProvider } from "./custom-models";

export type CustomProviderPreset = {
  id: string;
  label: string;
  /** Short hint shown under the chip */
  hint: string;
  draft: CustomProviderDraft;
};

const localCompat = {
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
} as const;

export const CUSTOM_PROVIDER_PRESETS: CustomProviderPreset[] = [
  {
    id: "longcat",
    label: "LongCat",
    hint: "OpenAI · 1M ctx",
    draft: emptyCustomProvider({
      id: "longcat",
      name: "LongCat",
      baseUrl: "https://api.longcat.chat/openai/v1",
      api: "openai-completions",
      apiKey: "",
      ...localCompat,
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
  },
  {
    id: "longcat-anthropic",
    label: "LongCat Anthropic",
    hint: "Messages API",
    draft: emptyCustomProvider({
      id: "longcat-anthropic",
      name: "LongCat (Anthropic)",
      baseUrl: "https://api.longcat.chat/anthropic",
      api: "anthropic-messages",
      apiKey: "",
      ...localCompat,
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
  },
  {
    id: "ollama",
    label: "Ollama",
    hint: "localhost:11434",
    draft: emptyCustomProvider({
      id: "ollama",
      name: "Ollama",
      baseUrl: "http://localhost:11434/v1",
      api: "openai-completions",
      apiKey: "ollama",
      ...localCompat,
      models: [{ id: "llama3.1:8b", name: "", reasoning: false }],
    }),
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    hint: "localhost:1234",
    draft: emptyCustomProvider({
      id: "lmstudio",
      name: "LM Studio",
      baseUrl: "http://127.0.0.1:1234/v1",
      api: "openai-completions",
      apiKey: "lmstudio",
      ...localCompat,
      models: [{ id: "", name: "", reasoning: false }],
    }),
  },
  {
    id: "vllm",
    label: "vLLM",
    hint: "OpenAI 兼容本地",
    draft: emptyCustomProvider({
      id: "vllm",
      name: "vLLM",
      baseUrl: "http://127.0.0.1:8000/v1",
      api: "openai-completions",
      apiKey: "vllm",
      ...localCompat,
      models: [{ id: "", name: "", reasoning: false }],
    }),
  },
  {
    id: "google-ai-studio",
    label: "Google AI Studio",
    hint: "generativelanguage",
    draft: emptyCustomProvider({
      id: "google-ai-studio",
      name: "Google AI Studio",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      api: "google-generative-ai",
      apiKey: "",
      supportsDeveloperRole: true,
      supportsReasoningEffort: true,
      models: [
        {
          id: "gemini-2.5-flash",
          name: "Gemini 2.5 Flash",
          reasoning: true,
          vision: true,
          contextWindow: 1_048_576,
          maxTokens: 65_536,
        },
      ],
    }),
  },
  {
    id: "openai-compatible",
    label: "OpenAI 兼容",
    hint: "代理 / 任意 /v1",
    draft: emptyCustomProvider({
      id: "openai-compatible",
      name: "OpenAI Compatible",
      baseUrl: "https://api.example.com/v1",
      api: "openai-completions",
      apiKey: "",
      ...localCompat,
      models: [{ id: "", name: "", reasoning: false, contextWindow: 128_000, maxTokens: 16_384 }],
    }),
  },
];

/**
 * Built-in provider platform catalog for the "add provider / add model" flow.
 *
 * Two kinds of platforms are offered:
 *  - `sdk`    — natively supported by the Pi SDK (`runtime.getProviders()`),
 *               configured by writing an API key to `auth.json`.
 *  - `custom` — OpenAI/Anthropic-compatible platforms the SDK does not know,
 *               configured as a `providers.<id>` entry in `models.json`.
 *
 * The Pi SDK already ships OpenCode Zen (`opencode` / `opencode-go`), so most
 * mainstream platforms are `sdk` entries that only need presentation metadata
 * (icon, category, ordering) from here.
 */

import type { CustomModelApi } from "./custom-models";
import type { ModelsProviderAuth } from "./models-settings";

export type ProviderPlatformKind = "sdk" | "custom";

export type ProviderPlatformCategory = "featured" | "china" | "local" | "generic" | "global";

/** models.json config for a platform the Pi SDK does not ship. */
export type CustomPlatformConfig = {
  id: string;
  name: string;
  baseUrl: string;
  api: CustomModelApi;
  /** Placeholder value written into models.json (local servers only). */
  apiKey?: string;
  supportsDeveloperRole: boolean;
  supportsReasoningEffort: boolean;
  /** Provider-level headers (never secrets). */
  headers?: Record<string, string>;
};

export type ProviderPlatform = {
  /** Stable catalog key. */
  key: string;
  kind: ProviderPlatformKind;
  /** Pi SDK provider id (`kind: "sdk"`) or models.json provider id. */
  providerId: string;
  /** Brand icon lookup id. */
  iconId: string;
  label: string;
  /** Locale-neutral sub-label: endpoint host, OAuth, or "OpenAI 兼容". */
  hint: string;
  category: ProviderPlatformCategory;
  /** Provider already set up (auth.json key present / models.json entry present). */
  configured: boolean;
  /** True when the platform can only authenticate through OAuth. */
  oauth?: boolean;
  /** Where to create an API key. */
  docsUrl?: string;
  custom?: CustomPlatformConfig;
};

type CustomPlatformSpec = CustomPlatformConfig & {
  category: ProviderPlatformCategory;
  docsUrl?: string;
};

const LOCAL_COMPAT = {
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
} as const;

const REMOTE_COMPAT = {
  supportsDeveloperRole: true,
  supportsReasoningEffort: true,
} as const;

/**
 * Platforms the Pi SDK does not ship. Base URLs are verified against each
 * vendor's OpenAI-compatible `/models` route.
 */
export const CUSTOM_PLATFORMS: CustomPlatformSpec[] = [
  {
    id: "commandcode",
    name: "Command Code",
    baseUrl: "https://api.commandcode.ai/provider/v1",
    api: "openai-completions",
    ...REMOTE_COMPAT,
    category: "featured",
    docsUrl: "https://commandcode.ai/docs/provider",
  },
  {
    id: "longcat",
    name: "LongCat",
    baseUrl: "https://api.longcat.chat/openai/v1",
    api: "openai-completions",
    ...REMOTE_COMPAT,
    category: "featured",
  },
  {
    id: "dashscope",
    name: "阿里云百炼 DashScope",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    api: "openai-completions",
    ...REMOTE_COMPAT,
    category: "china",
    docsUrl: "https://bailian.console.aliyun.com/",
  },
  {
    id: "doubao",
    name: "火山方舟 Doubao",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    api: "openai-completions",
    ...REMOTE_COMPAT,
    category: "china",
    docsUrl: "https://console.volcengine.com/ark",
  },
  {
    id: "zhipu",
    name: "智谱 BigModel",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    api: "openai-completions",
    ...REMOTE_COMPAT,
    category: "china",
    docsUrl: "https://open.bigmodel.cn/",
  },
  {
    id: "siliconflow",
    name: "硅基流动 SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    api: "openai-completions",
    ...REMOTE_COMPAT,
    category: "china",
    docsUrl: "https://cloud.siliconflow.cn/",
  },
  {
    id: "stepfun",
    name: "阶跃星辰 StepFun",
    baseUrl: "https://api.stepfun.com/v1",
    api: "openai-completions",
    ...REMOTE_COMPAT,
    category: "china",
    docsUrl: "https://platform.stepfun.com/",
  },
  {
    id: "hunyuan",
    name: "腾讯混元 Hunyuan",
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    api: "openai-completions",
    ...REMOTE_COMPAT,
    category: "china",
    docsUrl: "https://console.cloud.tencent.com/hunyuan",
  },
  {
    id: "baidu-qianfan",
    name: "百度千帆 Qianfan",
    baseUrl: "https://qianfan.baidubce.com/v2",
    api: "openai-completions",
    ...REMOTE_COMPAT,
    category: "china",
    docsUrl: "https://console.bce.baidu.com/qianfan",
  },
  {
    id: "modelscope",
    name: "魔搭 ModelScope",
    baseUrl: "https://api-inference.modelscope.cn/v1",
    api: "openai-completions",
    ...REMOTE_COMPAT,
    category: "china",
    docsUrl: "https://modelscope.cn/",
  },
  {
    id: "ppio",
    name: "PPIO 派欧云",
    baseUrl: "https://api.ppinfra.com/v3/openai",
    api: "openai-completions",
    ...REMOTE_COMPAT,
    category: "china",
    docsUrl: "https://ppio.com/",
  },
  {
    id: "sensenova",
    name: "商汤日日新 SenseNova",
    baseUrl: "https://api.sensenova.cn/v1/llm",
    api: "openai-completions",
    ...REMOTE_COMPAT,
    category: "china",
    docsUrl: "https://platform.sensenova.cn/",
  },
  {
    id: "giteeai",
    name: "Gitee AI",
    baseUrl: "https://ai.gitee.com/v1",
    api: "openai-completions",
    ...REMOTE_COMPAT,
    category: "china",
    docsUrl: "https://ai.gitee.com/",
  },
  {
    id: "iflytek",
    name: "讯飞星火 Spark",
    baseUrl: "https://spark-api-open.xf-yun.com/v1",
    api: "openai-completions",
    ...REMOTE_COMPAT,
    category: "china",
    docsUrl: "https://console.xfyun.cn/",
  },
  {
    id: "ollama",
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    api: "openai-completions",
    apiKey: "ollama",
    ...LOCAL_COMPAT,
    category: "local",
    docsUrl: "https://ollama.com/download",
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    baseUrl: "http://127.0.0.1:1234/v1",
    api: "openai-completions",
    apiKey: "lmstudio",
    ...LOCAL_COMPAT,
    category: "local",
    docsUrl: "https://lmstudio.ai/",
  },
  {
    id: "vllm",
    name: "vLLM",
    baseUrl: "http://127.0.0.1:8000/v1",
    api: "openai-completions",
    apiKey: "vllm",
    ...LOCAL_COMPAT,
    category: "local",
    docsUrl: "https://docs.vllm.ai/",
  },
  {
    id: "openai-compatible",
    name: "OpenAI 兼容端点",
    baseUrl: "",
    api: "openai-completions",
    ...LOCAL_COMPAT,
    category: "generic",
  },
];

/** Presentation metadata for Pi SDK providers (icon/category/order/docs). */
type SdkPresentation = {
  category: ProviderPlatformCategory;
  docsUrl?: string;
  /** Override the SDK display name when it is ambiguous. */
  label?: string;
};

/**
 * Curated ordering for the "featured" group. Any SDK provider not listed falls
 * into its metadata category (or `global`).
 */
export const FEATURED_PROVIDER_ORDER: string[] = [
  "commandcode",
  "opencode",
  "anthropic",
  "openai",
  "google",
  "deepseek",
  "zai-coding-cn",
  "qwen-token-plan-cn",
  "moonshotai-cn",
  "minimax-cn",
  "xiaomi",
  "longcat",
  "openrouter",
  "xai",
  "groq",
  "mistral",
  "together",
  "cerebras",
  "nvidia",
  "huggingface",
  "vercel-ai-gateway",
  "github-copilot",
  "openai-codex",
];

const SDK_PRESENTATION: Record<string, SdkPresentation> = {
  "zai-coding-cn": { category: "featured", docsUrl: "https://open.bigmodel.cn/" },
  zai: { category: "global", docsUrl: "https://z.ai/" },
  "qwen-token-plan-cn": { category: "featured", docsUrl: "https://bailian.console.aliyun.com/" },
  "qwen-token-plan": { category: "global" },
  "qwen-token-plan-individual": { category: "global" },
  "moonshotai-cn": { category: "featured", label: "Moonshot AI (CN)", docsUrl: "https://platform.moonshot.cn/" },
  moonshotai: { category: "global", docsUrl: "https://platform.moonshot.ai/" },
  "kimi-coding": { category: "global", docsUrl: "https://platform.moonshot.cn/" },
  "minimax-cn": { category: "featured", docsUrl: "https://platform.minimaxi.com/" },
  minimax: { category: "global", docsUrl: "https://platform.minimax.io/" },
  "opencode-go": { category: "global", docsUrl: "https://opencode.ai/docs/zen/" },
  "cloudflare-workers-ai": { category: "global" },
  "cloudflare-ai-gateway": { category: "global" },
  "amazon-bedrock": { category: "global" },
  "azure-openai-responses": { category: "global" },
  "google-vertex": { category: "global" },
  "github-copilot": { category: "featured" },
  "openai-codex": { category: "featured" },
  radius: { category: "global" },
};

function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Build the full, ordered platform list for the picker overlay. */
export function buildProviderPlatforms(input: {
  sdkProviders: ModelsProviderAuth[];
  /** Provider ids present in models.json (already added as custom providers). */
  customProviderIds?: Iterable<string>;
  /** Extra custom platform ids the user may still want (defaults to catalog). */
  includeCustomIds?: Iterable<string>;
}): ProviderPlatform[] {
  const customIds = new Set(input.customProviderIds ?? []);
  const customIdFilter = input.includeCustomIds ? new Set(input.includeCustomIds) : null;
  const platforms: ProviderPlatform[] = [];

  const sdkById = new Map(input.sdkProviders.map((p) => [p.id, p]));
  const orderedSdk = [
    ...FEATURED_PROVIDER_ORDER.filter((id) => sdkById.has(id)),
    ...[...sdkById.keys()]
      .filter((id) => !FEATURED_PROVIDER_ORDER.includes(id))
      .sort((a, b) =>
        (sdkById.get(a)?.displayName ?? a).localeCompare(sdkById.get(b)?.displayName ?? b),
      ),
  ];

  for (const id of orderedSdk) {
    const provider = sdkById.get(id);
    if (!provider) continue;
    const meta = SDK_PRESENTATION[id];
    const oauth = !provider.supportsApiKey;
    const featured = FEATURED_PROVIDER_ORDER.includes(id);
    const host = hostOf(provider.baseUrl);
    platforms.push({
      key: `sdk:${id}`,
      kind: "sdk",
      providerId: id,
      iconId: id,
      label: meta?.label ?? provider.displayName ?? id,
      hint: host || (oauth ? "OAuth" : provider.id),
      category: featured ? "featured" : (meta?.category ?? "global"),
      configured: provider.configured,
      oauth,
      docsUrl: meta?.docsUrl,
    });
  }

  for (const spec of CUSTOM_PLATFORMS) {
    if (customIdFilter && !customIdFilter.has(spec.id)) continue;
    platforms.push({
      key: `custom:${spec.id}`,
      kind: "custom",
      providerId: spec.id,
      iconId: spec.id,
      label: spec.name,
      hint: spec.baseUrl ? hostOf(spec.baseUrl) : "OpenAI compatible",
      category: spec.category,
      configured: customIds.has(spec.id),
      docsUrl: spec.docsUrl,
      custom: {
        id: spec.id,
        name: spec.name,
        baseUrl: spec.baseUrl,
        api: spec.api,
        apiKey: spec.apiKey,
        supportsDeveloperRole: spec.supportsDeveloperRole,
        supportsReasoningEffort: spec.supportsReasoningEffort,
        headers: spec.headers,
      },
    });
  }

  const categoryRank: Record<ProviderPlatformCategory, number> = {
    featured: 0,
    china: 1,
    global: 2,
    local: 3,
    generic: 4,
  };
  const featuredIndex = new Map(FEATURED_PROVIDER_ORDER.map((id, i) => [id, i]));
  platforms.sort((a, b) => {
    const byCategory = categoryRank[a.category] - categoryRank[b.category];
    if (byCategory !== 0) return byCategory;
    const ai = featuredIndex.get(a.providerId) ?? Number.MAX_SAFE_INTEGER;
    const bi = featuredIndex.get(b.providerId) ?? Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return a.label.localeCompare(b.label);
  });
  return platforms;
}

/** Find a custom platform spec by provider id. */
export function findCustomPlatform(providerId: string): CustomPlatformConfig | null {
  const spec = CUSTOM_PLATFORMS.find((p) => p.id === providerId.trim());
  if (!spec) return null;
  const { category: _category, docsUrl: _docsUrl, ...config } = spec;
  return config;
}

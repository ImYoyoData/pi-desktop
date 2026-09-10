/**
 * Brand identity for model providers: glyph + tile colour.
 *
 * Glyphs come from @lobehub/icons-static-svg (MIT) via
 * `node scripts/generate-provider-icons.mjs`; a few platform marks are
 * hand-authored here (see {@link EXTRA_BRAND_GLYPHS}).
 *
 * Provider ids are not stable across the Pi SDK and `models.json`, so lookup is
 * alias-first and falls back to a substring match before giving up.
 */

import { PROVIDER_ICON_GLYPHS, type BrandGlyph } from "./provider-icon-glyphs";

export type { BrandGlyph, BrandGlyphPath } from "./provider-icon-glyphs";

export type BrandVisual = {
  /** Icon key inside the glyph registry. */
  glyph: string;
  /** Tile background. */
  bg: string;
  /** Glyph colour drawn on top of {@link bg}. */
  fg: string;
};

/**
 * Command Code (commandcode.ai) ships a wordmark only, so their app-icon mark is
 * reproduced here from the official `safari-pinned-tab.svg` (potrace outline,
 * 700×700 with a y-flip group transform).
 */
const COMMANDCODE_GLYPH: BrandGlyph = {
  viewBox: "0 0 700 700",
  transform: "translate(0,700) scale(0.1,-0.1)",
  paths: [
    {
      d: "M2305 6994c-371-13-682-39-893-74-598-103-963-350-1172-795-126-267-186-576-222-1130-19-287-18-2669 0-2950 53-794 172-1175 464-1481 286-298 672-437 1367-489 616-47 2694-46 3267 0 685 56 1056 186 1339 470 289 289 424 685 475 1395 22 310 32 1055 27 1915-6 868-13 1102-42 1417-55 589-188 950-448 1216-305 311-678 435-1487 493-141 10-2428 21-2675 13zm33-1350c322-66 580-324 646-646 12-57 16-136 16-303v-225h948l5 243c4 201 8 255 25 318 67 248 222 437 447 545 138 67 195 79 370 79 143-1 154-2 245-33 279-96 476-307 552-587 29-111 29-297-1-410-69-261-263-478-511-572-113-43-194-53-431-53h-219v-948l238-5c253-5 310-14 432-64 243-99 438-327 495-576 47-209 17-419-88-607-57-102-205-250-307-307-433-242-960-71-1169 379-63 134-74 200-79 466l-4 232h-948v-219c0-149-5-243-14-294-60-312-299-565-611-649-112-30-298-30-410 0-519 139-776 708-534 1185 106 210 301 365 538 429 63 17 117 21 319 25l242 5v948h-225c-252 0-329 11-452 62-485 201-664 796-372 1232 116 174 310 306 514 349 93 20 248 21 343 1z",
    },
    {
      d: "M2080 5174c-187-50-302-241-256-425 31-119 118-216 231-256 42-15 84-18 260-18h210v210c0 176-3 218-18 260-39 111-136 200-252 230-72 18-103 18-175-1z",
    },
    {
      d: "M4705 5176c-75-19-125-49-178-105-86-92-91-112-95-373l-3-228h185c264 0 337 20 429 119 74 79 92 127 92 241 0 83-3 102-27 150-74 150-249 236-403 196z",
    },
    { d: "M3000 3525v-475h950v950h-950v-475z" },
    {
      d: "M2051 2550c-59-22-68-27-129-84-178-167-127-463 98-574 48-24 67-27 150-27 114 0 162 18 241 92 99 92 119 165 119 428v185h-212c-184-1-220-3-267-20z",
    },
    {
      d: "M4432 2348l3-224 33-66c38-77 92-130 171-167 48-22 70-26 146-26 82 0 97 3 157 33 77 38 130 92 167 171 22 47 26 70 26 146 0 76-4 99-26 146-37 79-90 133-167 171l-66 33-224 3-223 3 3-223z",
    },
  ],
};

/** Marks we author ourselves because upstream icon sets do not ship them. */
export const EXTRA_BRAND_GLYPHS: Record<string, BrandGlyph> = {
  commandcode: COMMANDCODE_GLYPH,
  /**
   * Generic "OpenAI-compatible endpoint" mark: a plug, so the custom/self-hosted
   * entry never masquerades as a specific vendor.
   */
  "api-generic": {
    viewBox: "0 0 24 24",
    paths: [
      {
        d: "M9 2a1 1 0 0 1 1 1v4h1V3a1 1 0 1 1 2 0v4h1V3a1 1 0 1 1 2 0v4.1A4.9 4.9 0 0 1 21 12v.5c0 2-1.2 3.7-3 4.4V21a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1v-3.1a5.6 5.6 0 0 1-5 0V21a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4.1a4.9 4.9 0 0 1-3-4.4V12a4.9 4.9 0 0 1 5-4.9V3a1 1 0 0 1 1-1Zm3 7.5A2.5 2.5 0 0 0 9.5 12 2.5 2.5 0 0 0 12 14.5 2.5 2.5 0 0 0 14.5 12 2.5 2.5 0 0 0 12 9.5Z",
      },
    ],
  },
};

/** Tile colours per icon key. Keys match {@link BrandVisual.glyph}. */
const BRAND_COLORS: Record<string, { bg: string; fg: string }> = {
  commandcode: { bg: "#15161a", fg: "#ffffff" },
  "api-generic": { bg: "#6b7280", fg: "#ffffff" },
  anthropic: { bg: "#d97757", fg: "#ffffff" },
  openai: { bg: "#10a37f", fg: "#ffffff" },
  codex: { bg: "#0b7a5f", fg: "#ffffff" },
  gemini: { bg: "#4285f4", fg: "#ffffff" },
  vertexai: { bg: "#1a73e8", fg: "#ffffff" },
  deepseek: { bg: "#4d6bfe", fg: "#ffffff" },
  openrouter: { bg: "#6467f2", fg: "#ffffff" },
  xai: { bg: "#0f1115", fg: "#ffffff" },
  zai: { bg: "#3b5bfe", fg: "#ffffff" },
  qwen: { bg: "#615ced", fg: "#ffffff" },
  moonshot: { bg: "#111318", fg: "#ffffff" },
  kimi: { bg: "#111318", fg: "#ffffff" },
  minimax: { bg: "#e01616", fg: "#ffffff" },
  xiaomimimo: { bg: "#ff6900", fg: "#ffffff" },
  longcat: { bg: "#f5b800", fg: "#1a1a1a" },
  groq: { bg: "#f55036", fg: "#ffffff" },
  mistral: { bg: "#ff7000", fg: "#ffffff" },
  githubcopilot: { bg: "#24292f", fg: "#ffffff" },
  together: { bg: "#0f6fff", fg: "#ffffff" },
  cerebras: { bg: "#ff6b35", fg: "#ffffff" },
  fireworks: { bg: "#6e29f7", fg: "#ffffff" },
  nvidia: { bg: "#76b900", fg: "#1a1a1a" },
  huggingface: { bg: "#ffd21e", fg: "#1a1a1a" },
  vercel: { bg: "#0f1115", fg: "#ffffff" },
  cloudflare: { bg: "#f38020", fg: "#ffffff" },
  workersai: { bg: "#f38020", fg: "#ffffff" },
  bedrock: { bg: "#ff9900", fg: "#1a1a1a" },
  azureai: { bg: "#0078d4", fg: "#ffffff" },
  baseten: { bg: "#0f9d8c", fg: "#ffffff" },
  antgroup: { bg: "#1677ff", fg: "#ffffff" },
  perplexity: { bg: "#20808d", fg: "#ffffff" },
  doubao: { bg: "#1664ff", fg: "#ffffff" },
  siliconcloud: { bg: "#6e56cf", fg: "#ffffff" },
  zhipu: { bg: "#0f62fe", fg: "#ffffff" },
  stepfun: { bg: "#00b96b", fg: "#ffffff" },
  hunyuan: { bg: "#0052d9", fg: "#ffffff" },
  wenxin: { bg: "#2932e1", fg: "#ffffff" },
  modelscope: { bg: "#624aff", fg: "#ffffff" },
  ppio: { bg: "#4f46e5", fg: "#ffffff" },
  sensenova: { bg: "#0ea5e9", fg: "#ffffff" },
  skywork: { bg: "#2563eb", fg: "#ffffff" },
  giteeai: { bg: "#c71d23", fg: "#ffffff" },
  iflytekcloud: { bg: "#1464f4", fg: "#ffffff" },
  ollama: { bg: "#0f1115", fg: "#ffffff" },
  lmstudio: { bg: "#6d28d9", fg: "#ffffff" },
  vllm: { bg: "#f59e0b", fg: "#1a1a1a" },
  opencode: { bg: "#101114", fg: "#ffffff" },
};

/**
 * Exact provider id → icon key. Covers Pi SDK provider ids (`runtime.getProviders()`)
 * plus the ids shipped by our own catalog.
 */
const PROVIDER_ICON_ALIASES: Record<string, string> = {
  // Pi SDK providers
  "amazon-bedrock": "bedrock",
  "ant-ling": "antgroup",
  anthropic: "anthropic",
  "azure-openai-responses": "azureai",
  baseten: "baseten",
  cerebras: "cerebras",
  "cloudflare-ai-gateway": "cloudflare",
  "cloudflare-workers-ai": "workersai",
  deepseek: "deepseek",
  fireworks: "fireworks",
  "github-copilot": "githubcopilot",
  google: "gemini",
  "google-vertex": "vertexai",
  groq: "groq",
  huggingface: "huggingface",
  "kimi-coding": "kimi",
  minimax: "minimax",
  "minimax-cn": "minimax",
  mistral: "mistral",
  moonshotai: "moonshot",
  "moonshotai-cn": "moonshot",
  nvidia: "nvidia",
  openai: "openai",
  "openai-codex": "codex",
  opencode: "opencode",
  "opencode-go": "opencode",
  openrouter: "openrouter",
  "qwen-token-plan": "qwen",
  "qwen-token-plan-cn": "qwen",
  "qwen-token-plan-individual": "qwen",
  together: "together",
  "vercel-ai-gateway": "vercel",
  xai: "xai",
  xiaomi: "xiaomimimo",
  "xiaomi-token-plan-ams": "xiaomimimo",
  "xiaomi-token-plan-cn": "xiaomimimo",
  "xiaomi-token-plan-sgp": "xiaomimimo",
  zai: "zai",
  "zai-coding-cn": "zai",
  // Our own catalog / models.json conventions
  commandcode: "commandcode",
  "command-code": "commandcode",
  cmd: "commandcode",
  claude: "anthropic",
  gemini: "gemini",
  "google-ai-studio": "gemini",
  gpt: "openai",
  kimi: "kimi",
  longcat: "longcat",
  "longcat-anthropic": "longcat",
  "minimax-cn-anthropic": "minimax",
  "openai-compatible": "api-generic",
  qwen: "qwen",
  dashscope: "qwen",
  bailian: "qwen",
  zhipu: "zhipu",
  bigmodel: "zhipu",
  glm: "zai",
  doubao: "doubao",
  volcengine: "doubao",
  ark: "doubao",
  siliconflow: "siliconcloud",
  stepfun: "stepfun",
  hunyuan: "hunyuan",
  "baidu-qianfan": "wenxin",
  wenxin: "wenxin",
  ernie: "wenxin",
  modelscope: "modelscope",
  ppio: "ppio",
  sensenova: "sensenova",
  skywork: "skywork",
  giteeai: "giteeai",
  "gitee-ai": "giteeai",
  iflytek: "iflytekcloud",
  spark: "iflytekcloud",
  perplexity: "perplexity",
  cohere: "cohere",
  ollama: "ollama",
  lmstudio: "lmstudio",
  "lm-studio": "lmstudio",
  vllm: "vllm",
  llamacpp: "api-generic",
  "llama.cpp": "api-generic",
};

/** Substring fallbacks, longest key wins. */
const SUBSTRING_ALIASES: Array<[string, string]> = [
  ["commandcode", "commandcode"],
  ["command-code", "commandcode"],
  ["opencode", "opencode"],
  ["cloudflare-workers", "workersai"],
  ["cloudflare", "cloudflare"],
  ["moonshot", "moonshot"],
  ["kimi", "kimi"],
  ["xiaomi", "xiaomimimo"],
  ["mimo", "xiaomimimo"],
  ["qwen", "qwen"],
  ["dashscope", "qwen"],
  ["zai", "zai"],
  ["zhipu", "zhipu"],
  ["deepseek", "deepseek"],
  ["minimax", "minimax"],
  ["anthropic", "anthropic"],
  ["claude", "anthropic"],
  ["gemini", "gemini"],
  ["vertex", "vertexai"],
  ["openai", "openai"],
  ["codex", "codex"],
  ["copilot", "githubcopilot"],
  ["mistral", "mistral"],
  ["groq", "groq"],
  ["openrouter", "openrouter"],
  ["together", "together"],
  ["cerebras", "cerebras"],
  ["fireworks", "fireworks"],
  ["nvidia", "nvidia"],
  ["huggingface", "huggingface"],
  ["vercel", "vercel"],
  ["bedrock", "bedrock"],
  ["azure", "azureai"],
  ["baseten", "baseten"],
  ["ant-ling", "antgroup"],
  ["longcat", "longcat"],
  ["stepfun", "stepfun"],
  ["hunyuan", "hunyuan"],
  ["siliconflow", "siliconcloud"],
  ["modelscope", "modelscope"],
  ["ppio", "ppio"],
  ["sensenova", "sensenova"],
  ["skywork", "skywork"],
  ["gitee", "giteeai"],
  ["iflytek", "iflytekcloud"],
  ["perplexity", "perplexity"],
  ["ollama", "ollama"],
  ["lmstudio", "lmstudio"],
  ["vllm", "vllm"],
  ["xai", "xai"],
  ["grok", "xai"],
];

/**
 * Resolve the brand icon key for an arbitrary provider id, or null when unknown.
 *
 * Exact ids win first. Otherwise the match closest to the start of the id wins
 * (ties broken by the longer needle), so `longcat-anthropic` resolves to LongCat
 * rather than Anthropic while `cloudflare-workers-ai` still resolves to
 * Workers AI.
 */
export function resolveBrandIconKey(providerId: string): string | null {
  const raw = providerId?.trim().toLowerCase();
  if (!raw) return null;
  const exact = PROVIDER_ICON_ALIASES[raw];
  if (exact) return exact;
  let best: { key: string; index: number; len: number } | null = null;
  for (const [needle, key] of SUBSTRING_ALIASES) {
    const index = raw.indexOf(needle);
    if (index < 0) continue;
    const candidate = { key, index, len: needle.length };
    if (
      !best ||
      candidate.index < best.index ||
      (candidate.index === best.index && candidate.len > best.len)
    ) {
      best = candidate;
    }
  }
  return best?.key ?? null;
}

/** Glyph + colours for a provider id. `null` when we have no brand mark for it. */
export function resolveBrandVisual(providerId: string): BrandVisual | null {
  const key = resolveBrandIconKey(providerId);
  if (!key) return null;
  return { glyph: key, ...(BRAND_COLORS[key] ?? { bg: "#6b7280", fg: "#ffffff" }) };
}

/** Glyph by icon key (registry + hand-authored marks). */
export function brandGlyph(key: string): BrandGlyph | null {
  return PROVIDER_ICON_GLYPHS[key] ?? EXTRA_BRAND_GLYPHS[key] ?? null;
}

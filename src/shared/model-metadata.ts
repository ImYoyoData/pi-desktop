/**
 * Token-limit defaults and heuristics shared by the model forms and discovery.
 *
 * Pi falls back to a 128000 context window / 16384 max-output when a model
 * entry omits them. The GUI deliberately prefers a larger output budget
 * ({@link DEFAULT_MAX_TOKENS}) because coding agents routinely stream long
 * answers, and most endpoints ignore `max_tokens` values above their own cap.
 */

/** Output budget applied to any model that does not report one. */
export const DEFAULT_MAX_TOKENS = 32_768;

/** Pi SDK fallback for a model entry without `contextWindow`. */
export const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * Best-effort context window for well-known model families. Only consulted when
 * neither the endpoint nor the SDK catalog reports one, so it never overrides
 * real metadata.
 */
const CONTEXT_HEURISTICS: Array<[RegExp, number]> = [
  [/gemini-(3|2\.5)/iu, 1_048_576],
  [/claude-fable|claude-opus-5/iu, 1_000_000],
  [/claude/iu, 200_000],
  [/gpt-5\.6|gpt-6/iu, 1_050_000],
  [/gpt-5/iu, 400_000],
  [/gpt-4\.1|gpt-4o/iu, 128_000],
  [/deepseek-v4/iu, 1_000_000],
  [/deepseek/iu, 131_072],
  [/kimi-k3/iu, 1_000_000],
  [/kimi|moonshot/iu, 256_000],
  [/qwen3\.[5-9]/iu, 1_000_000],
  [/minimax-m3/iu, 1_000_000],
  [/minimax/iu, 200_000],
  [/grok-4/iu, 500_000],
  [/mimo/iu, 1_000_000],
  [/longcat/iu, 1_048_576],
  [/glm-5\.(2|3)/iu, 1_000_000],
  [/glm/iu, 200_000],
];

/** Heuristic context window for a model id, or undefined when unknown. */
export function guessContextWindow(modelId: string): number | undefined {
  const id = modelId?.trim();
  if (!id) return undefined;
  for (const [pattern, value] of CONTEXT_HEURISTICS) {
    if (pattern.test(id)) return value;
  }
  return undefined;
}

/**
 * Output budget for a discovered/created model: keep what the provider reported,
 * otherwise apply {@link DEFAULT_MAX_TOKENS}.
 */
export function resolveMaxTokens(reported?: number | null): number {
  return typeof reported === "number" && Number.isFinite(reported) && reported > 0
    ? Math.floor(reported)
    : DEFAULT_MAX_TOKENS;
}

/** Context window for a discovered/created model, falling back to the heuristic table. */
export function resolveContextWindow(
  reported: number | null | undefined,
  modelId: string,
): number | undefined {
  if (typeof reported === "number" && Number.isFinite(reported) && reported > 0) {
    return Math.floor(reported);
  }
  return guessContextWindow(modelId);
}

/* -------------------------------------------------------------------------- */
/* Capability detection (extended thinking + image input)                     */
/* -------------------------------------------------------------------------- */

export type ModelCapabilities = {
  reasoning: boolean;
  vision: boolean;
  /** Where the answer came from; `inferred` means only the id was available. */
  source: "reported" | "inferred" | "unknown";
};

/** Values a provider may have reported (all optional). */
export type ReportedCapabilities = {
  reasoning?: boolean;
  vision?: boolean;
};

/**
 * Extended-thinking families. Order matters: the first match wins, so put the
 * specific patterns (reasoning-only SKUs) before the family-wide ones.
 */
const REASONING_PATTERNS: RegExp[] = [
  // Explicit opt-ins in the id.
  /(^|[/\-_])think(ing)?([\-_.]|$)/iu,
  /(^|[/\-_])reason(er|ing)?([\-_.]|$)/iu,
  /\br1\b|deepseek-r1/iu,
  // OpenAI reasoning SKUs (o1/o3/o4 + GPT-5 and later).
  /(^|[/\-_])o[134]([\-_.]|$)/iu,
  /gpt-[5-9]/iu,
  // Anthropic: extended thinking landed in Claude 3.7 and is on for 4/5-gen.
  /claude-(3[-.]7|4|5)/iu,
  /claude-(fable|opus|sonnet-5|haiku-4)/iu,
  // Google: thinking is default from Gemini 2.5 on.
  /gemini-([2-9]\.5|[3-9])/iu,
  // DeepSeek reasoning line.
  /deepseek-(r1|v3\.[12]|v4)/iu,
  // Moonshot / Kimi.
  /kimi-(k2|k3)|moonshot.*(thinking|k2|k3)/iu,
  // Zhipu GLM 4.5+ / 5.x.
  /glm-([45]\.[5-9]|[5-9])/iu,
  // Alibaba Qwen3+ (hybrid thinking) and explicit thinking SKUs.
  /qwen-?3|qwen.*thinking/iu,
  // MiniMax M2+.
  /minimax-m[2-9]/iu,
  // xAI Grok 3/4.
  /grok-[3-9]/iu,
  // Others known to ship a reasoning mode.
  /mimo-v[2-9]/iu,
  /step-[3-9]/iu,
  /nemotron-[2-9]/iu,
  /ling-[2-9]/iu,
  /hunyuan.*(thinking|t1)/iu,
  /ernie-[45]/iu,
];

/**
 * Image-input families. Kept to models/vendors that actually accept images, so a
 * false positive does not let the composer attach an image the model rejects.
 */
const VISION_PATTERNS: RegExp[] = [
  // Explicit opt-ins.
  /(^|[/\-_])v[l]?([\-_.]|$)/iu,
  /vision|multimodal|omni/iu,
  /(^|[/\-_])image([\-_.]|$)/iu,
  // Anthropic: Claude 3 and later accept images.
  /claude-([3-9]|fable|opus|sonnet|haiku)/iu,
  // OpenAI: GPT-4o/4.1/4-turbo/5+ and the o-series reasoners are multimodal.
  /gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision/iu,
  /gpt-[5-9]/iu,
  /(^|[/\-_])o[134]([\-_.]|$)/iu,
  // Google Gemini is multimodal across the line.
  /gemini-/iu,
  // Qwen-VL, GLM-4V, InternVL, MiniCPM-V …
  /qwen.*vl|glm-[0-9.]+v|internvl|minicpm-v|cogvlm/iu,
  // Llama 3.2 vision / Llama 4 are multimodal.
  /llama-3\.2.*vision|llama-4/iu,
  /pixtral/iu,
  // Grok 2+ ships vision.
  /grok-[2-9]/iu,
  /mimo.*vl|doubao.*vision|hunyuan.*vision|ernie.*vl|step-1v/iu,
  /deepseek-vl|kimi.*vl|nemotron.*vl/iu,
];

function matchesAny(patterns: RegExp[], modelId: string): boolean {
  return patterns.some((p) => p.test(modelId));
}

/**
 * Detect what a model supports, preferring anything the provider reported.
 *
 * `reported` wins only when it is an explicit boolean, so a provider that says
 * nothing does not mask the id-based fallback. This is what removes the manual
 * "推理 / 图片" switches from the custom-model form.
 */
export function inferModelCapabilities(
  modelId: string,
  reported?: ReportedCapabilities,
): ModelCapabilities {
  const id = modelId?.trim() ?? "";
  const inferredReasoning = id ? matchesAny(REASONING_PATTERNS, id) : false;
  const inferredVision = id ? matchesAny(VISION_PATTERNS, id) : false;

  const reasoning = typeof reported?.reasoning === "boolean" ? reported.reasoning : inferredReasoning;
  const vision = typeof reported?.vision === "boolean" ? reported.vision : inferredVision;
  const reportedSomething =
    typeof reported?.reasoning === "boolean" || typeof reported?.vision === "boolean";

  return {
    reasoning,
    vision,
    source: reportedSomething ? "reported" : id && (reasoning || vision) ? "inferred" : "unknown",
  };
}


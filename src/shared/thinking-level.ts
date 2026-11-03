/** Pi 思考级别（pi-ai ThinkingLevel + off），主进程 / worker / 渲染进程共用。 */
export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export const THINKING_LEVELS: { value: ThinkingLevel; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "XHigh" },
  { value: "max", label: "Max" },
];

const LABELS = new Map(THINKING_LEVELS.map((level) => [level.value, level.label]));

/** 判断是否为合法思考级别。 */
export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && LABELS.has(value as ThinkingLevel);
}

/** 思考级别的显示名，未知级别返回 null。 */
export function thinkingLevelLabel(value: unknown): string | null {
  return isThinkingLevel(value) ? (LABELS.get(value) ?? null) : null;
}

/** 未配置 thinkingLevelMap 的推理模型可用档位：xhigh/max 需要显式 opt-in。 */
export const DEFAULT_SUPPORTED_THINKING_LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
];

function asLevelRecord(map: unknown): Record<string, unknown> | null {
  return map && typeof map === "object" && !Array.isArray(map)
    ? (map as Record<string, unknown>)
    : null;
}

/**
 * 模型真实可用的思考档位，与 Pi SDK 的 getSupportedThinkingLevels 一致：
 * 非推理模型只有 off；minimal..high 缺失视为可用，显式 null 不可用；
 * xhigh/max 只有显式非 null 映射才可用。
 */
export function supportedThinkingLevels(model: {
  reasoning?: boolean;
  thinkingLevelMap?: unknown;
}): ThinkingLevel[] {
  if (!model.reasoning) return ["off"];
  const map = asLevelRecord(model.thinkingLevelMap);
  return THINKING_LEVELS.filter(({ value }) => {
    const mapped = map?.[value];
    if (mapped === null) return false;
    if (value === "xhigh" || value === "max") return typeof mapped === "string";
    return true;
  }).map(({ value }) => value);
}

/**
 * 文件里显式声明过的档位集合；没有任何 thinkingLevelMap 配置时返回 undefined。
 * 有配置但所有键都被忽略时也返回 undefined，与旧行为一致。
 */
export function declaredThinkingLevels(map: unknown): ThinkingLevel[] | undefined {
  const record = asLevelRecord(map);
  if (!record) return undefined;
  if (!THINKING_LEVELS.some(({ value }) => value in record)) return undefined;
  return supportedThinkingLevels({ reasoning: true, thinkingLevelMap: record });
}

/** 把请求档位裁剪到可用集合：先向更高档找，再向更低档找（与 SDK 一致）。 */
export function clampThinkingLevel(
  level: ThinkingLevel,
  levels: readonly ThinkingLevel[],
): ThinkingLevel {
  if (levels.includes(level)) return level;
  const available = new Set(levels);
  const requested = THINKING_LEVELS.findIndex(({ value }) => value === level);
  for (let i = Math.max(requested, 0); i < THINKING_LEVELS.length; i += 1) {
    if (available.has(THINKING_LEVELS[i].value)) return THINKING_LEVELS[i].value;
  }
  for (let i = requested - 1; i >= 0; i -= 1) {
    if (available.has(THINKING_LEVELS[i].value)) return THINKING_LEVELS[i].value;
  }
  return levels[0] ?? "off";
}

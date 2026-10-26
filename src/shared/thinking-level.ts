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

/**
 * 从模型定义的 thinkingLevelMap 读可用档位：显式 null 表示不可用，缺失键按可用处理
 * （桌面端会为缺失的档位补齐映射）。没有映射时返回 undefined，表示全档位可用。
 */
export function availableThinkingLevels(map: unknown): ThinkingLevel[] | undefined {
  if (!map || typeof map !== "object" || Array.isArray(map)) return undefined;
  const record = map as Record<string, unknown>;
  if (!THINKING_LEVELS.some((level) => level.value in record)) return undefined;
  return THINKING_LEVELS.filter((level) => record[level.value] !== null).map(
    (level) => level.value,
  );
}

/** Pi 思考级别（pi-ai ThinkingLevel + off） */
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

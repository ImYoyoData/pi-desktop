/** Resolve UI / Monaco locale from system language. zh-hant → 繁中, ja → 日本語, zh* → 简中, else English. */
export type UiLocale = "zh-CN" | "zh-TW" | "ja" | "en";

export function detectSystemLanguage(): string {
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
  }
  return "en";
}

/** 支持的界面语言：偏好校验与 IPC 入口共用。 */
const UI_LOCALES: readonly UiLocale[] = ["zh-CN", "zh-TW", "ja", "en"];

/** 校验来自持久化偏好或 IPC 的语言标识。 */
export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === "string" && (UI_LOCALES as readonly string[]).includes(value);
}

export function resolveUiLocale(lang = detectSystemLanguage()): UiLocale {
  const lower = lang.toLowerCase().replace(/_/g, "-");
  if (lower === "zh-tw" || lower.startsWith("zh-hant") || lower === "zh-hk" || lower === "zh-mo") {
    return "zh-TW";
  }
  if (lower.startsWith("zh")) return "zh-CN";
  if (lower.startsWith("ja")) return "ja";
  return "en";
}

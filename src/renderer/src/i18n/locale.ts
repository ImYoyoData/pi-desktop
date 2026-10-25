/** Resolve UI / Monaco locale from system language. zh-hant → 繁中, ja → 日本語, zh* → 简中, else English. */
export type UiLocale = "zh-CN" | "zh-TW" | "ja" | "en";

/** Monaco nls pack ids we ship (under monaco-editor/esm/vs/nls/lang/). */
export type MonacoNlsId =
  | "zh-cn"
  | "zh-tw"
  | "ja"
  | "ko"
  | "de"
  | "fr"
  | "es"
  | "ru"
  | "it"
  | "pt-br"
  | "tr"
  | "pl"
  | "cs";

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

/**
 * Map system language → Monaco nls pack.
 * Returns null for English (Monaco default — do not load a pack).
 */
export function resolveMonacoNls(lang = detectSystemLanguage()): MonacoNlsId | null {
  const lower = lang.toLowerCase().replace(/_/g, "-");
  if (lower === "zh-tw" || lower.startsWith("zh-hant") || lower === "zh-hk" || lower === "zh-mo") {
    return "zh-tw";
  }
  if (lower.startsWith("zh")) return "zh-cn";
  if (lower.startsWith("ja")) return "ja";
  if (lower.startsWith("ko")) return "ko";
  if (lower.startsWith("de")) return "de";
  if (lower.startsWith("fr")) return "fr";
  if (lower.startsWith("es")) return "es";
  if (lower.startsWith("ru")) return "ru";
  if (lower.startsWith("it")) return "it";
  if (lower.startsWith("pt")) return "pt-br";
  if (lower.startsWith("tr")) return "tr";
  if (lower.startsWith("pl")) return "pl";
  if (lower.startsWith("cs")) return "cs";
  return null;
}

/** Resolve UI / Monaco locale from system language. Chinese when zh*, else English. */
export type UiLocale = "zh-CN" | "en";

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

export function resolveUiLocale(lang = detectSystemLanguage()): UiLocale {
  const lower = lang.toLowerCase();
  if (lower.startsWith("zh")) return "zh-CN";
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

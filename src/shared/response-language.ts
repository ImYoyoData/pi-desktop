/**
 * Response language for the assistant's answers.
 *
 * Separate from the UI locale: the interface can stay English while Pi answers in
 * Chinese, and vice versa. `auto` follows the device/browser language, which is
 * what most users want, so that is the default.
 *
 * Stored in `userData/response-language.json` (app-wide, like the proxy and model
 * selection settings) and passed into each agent worker at init, where it becomes
 * a system-prompt instruction.
 */

export const RESPONSE_LANGUAGE_AUTO = "auto";

/** One selectable option for the settings dropdown. */
export type ResponseLanguageOption = {
  /** Stored value (`auto` or a BCP-47-ish tag we control). */
  value: string;
  /** Name written into the system prompt, in the language itself. */
  nativeName: string;
  /** English name, used when the prompt needs a second anchor. */
  englishName: string;
  /** Matched against `navigator.language` when resolving `auto`. */
  prefixes: string[];
};

/**
 * Languages offered in Settings. Deliberately a curated list rather than every
 * BCP-47 tag: each entry needs a stable name for the prompt, and users can pick
 * "auto" for anything not listed.
 */
export const RESPONSE_LANGUAGE_OPTIONS: ResponseLanguageOption[] = [
  { value: "zh-CN", nativeName: "简体中文", englishName: "Chinese (Simplified)", prefixes: ["zh-cn", "zh-hans", "zh-sg", "zh"] },
  { value: "zh-TW", nativeName: "繁體中文", englishName: "Chinese (Traditional)", prefixes: ["zh-tw", "zh-hant", "zh-hk", "zh-mo"] },
  { value: "en", nativeName: "English", englishName: "English", prefixes: ["en"] },
  { value: "ja", nativeName: "日本語", englishName: "Japanese", prefixes: ["ja"] },
  { value: "ko", nativeName: "한국어", englishName: "Korean", prefixes: ["ko"] },
  { value: "es", nativeName: "Español", englishName: "Spanish", prefixes: ["es"] },
  { value: "fr", nativeName: "Français", englishName: "French", prefixes: ["fr"] },
  { value: "de", nativeName: "Deutsch", englishName: "German", prefixes: ["de"] },
  { value: "ru", nativeName: "Русский", englishName: "Russian", prefixes: ["ru"] },
  { value: "pt-BR", nativeName: "Português (Brasil)", englishName: "Portuguese (Brazil)", prefixes: ["pt-br", "pt"] },
  { value: "it", nativeName: "Italiano", englishName: "Italian", prefixes: ["it"] },
  { value: "nl", nativeName: "Nederlands", englishName: "Dutch", prefixes: ["nl"] },
  { value: "pl", nativeName: "Polski", englishName: "Polish", prefixes: ["pl"] },
  { value: "tr", nativeName: "Türkçe", englishName: "Turkish", prefixes: ["tr"] },
  { value: "uk", nativeName: "Українська", englishName: "Ukrainian", prefixes: ["uk"] },
  { value: "ar", nativeName: "العربية", englishName: "Arabic", prefixes: ["ar"] },
  { value: "hi", nativeName: "हिन्दी", englishName: "Hindi", prefixes: ["hi"] },
  { value: "th", nativeName: "ไทย", englishName: "Thai", prefixes: ["th"] },
  { value: "vi", nativeName: "Tiếng Việt", englishName: "Vietnamese", prefixes: ["vi"] },
  { value: "id", nativeName: "Bahasa Indonesia", englishName: "Indonesian", prefixes: ["id", "in"] },
];

export type ResponseLanguageSettings = {
  /** `auto` (follow the device) or a value from RESPONSE_LANGUAGE_OPTIONS. */
  language: string;
};

/**
 * What the settings UI receives over IPC: the stored value, the choices, and the
 * language that is actually in effect right now.
 */
export type ResponseLanguageState = {
  settings: ResponseLanguageSettings;
  /** Languages offered in the dropdown (`value` + `label`); `auto` is included. */
  options: { value: string; label: string }[];
  /** Effective language (never `auto`). */
  effective: string;
  /** Device language last reported by the renderer. */
  deviceLanguage: string;
};

export const DEFAULT_RESPONSE_LANGUAGE_SETTINGS: ResponseLanguageSettings = { language: RESPONSE_LANGUAGE_AUTO };

/** Name shown in the Settings dropdown for one stored value. */
export function responseLanguageLabel(value: string): string {
  if (value === RESPONSE_LANGUAGE_AUTO) return "";
  return RESPONSE_LANGUAGE_OPTIONS.find((o) => o.value === value)?.nativeName ?? value;
}

export function isResponseLanguage(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (value === RESPONSE_LANGUAGE_AUTO || RESPONSE_LANGUAGE_OPTIONS.some((o) => o.value === value))
  );
}

/** Tolerate partial/corrupt JSON: unknown values fall back to `auto`. */
export function parseResponseLanguageSettings(raw: unknown): ResponseLanguageSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_RESPONSE_LANGUAGE_SETTINGS };
  const language = (raw as { language?: unknown }).language;
  return { language: isResponseLanguage(language) ? language : RESPONSE_LANGUAGE_AUTO };
}

/**
 * Longest-prefix match against `navigator.language`.
 *
 * Matching must consider specificity across ALL options, not option by option:
 * `zh-Hant-TW` has to resolve to Traditional Chinese even though the generic
 * `zh` prefix (Simplified) is declared first. Comparing the longest matching
 * prefix globally fixes that — a per-option walk would return Simplified for any
 * `zh-*` tag.
 */
export function languageForDeviceTag(deviceTag: string | null | undefined): string {
  const tag = String(deviceTag ?? "").toLowerCase().replace(/_/gu, "-");
  if (!tag) return "en";
  const pairs: { prefix: string; value: string }[] = [];
  for (const option of RESPONSE_LANGUAGE_OPTIONS) {
    for (const prefix of option.prefixes) pairs.push({ prefix, value: option.value });
  }
  // Longest prefix wins; ties keep declaration order.
  pairs.sort((a, b) => b.prefix.length - a.prefix.length);
  for (const { prefix, value } of pairs) {
    if (tag === prefix || tag.startsWith(`${prefix}-`)) return value;
  }
  // Unknown device language: hand the raw tag to the model rather than guessing a
  // language we might get wrong.
  return tag;
}

/**
 * Resolve the language to instruct the model to answer in.
 *
 * `deviceTag` is `navigator.language` from the renderer (or a worker-side
 * fallback), consulted only in `auto` mode.
 */
export function resolveResponseLanguage(
  settings: ResponseLanguageSettings,
  deviceTag?: string | null,
): string {
  const configured = parseResponseLanguageSettings(settings).language;
  return configured === RESPONSE_LANGUAGE_AUTO ? languageForDeviceTag(deviceTag) : configured;
}

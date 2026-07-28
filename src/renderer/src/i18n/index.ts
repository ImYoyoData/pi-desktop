import { en } from "./en";
import { zh } from "./zh-CN";
import { detectSystemLanguage, resolveUiLocale, type UiLocale } from "./locale";

export type Messages = typeof zh;

function readStoredLocalePreference(): "system" | "zh-CN" | "en" {
  try {
    const raw = localStorage.getItem("pi-desktop:locale-preference");
    if (raw === "zh-CN" || raw === "en" || raw === "system") return raw;
  } catch {
    // ignore
  }
  return "system";
}

function resolveActiveLocale(): UiLocale {
  const pref = readStoredLocalePreference();
  if (pref === "zh-CN" || pref === "en") return pref;
  return resolveUiLocale(detectSystemLanguage());
}

const locale: UiLocale = resolveActiveLocale();

/** Active UI strings — Chinese when zh*, otherwise English (or user override). */
export const t: Messages = locale === "zh-CN" ? zh : en;

/** Compile-time guard: en must stay key-compatible with zh. */
const _enCompat: Messages = en;
void _enCompat;

export { zh, en, locale, resolveUiLocale };
export {
  detectSystemLanguage,
  resolveMonacoNls,
  type MonacoNlsId,
  type UiLocale,
} from "./locale";

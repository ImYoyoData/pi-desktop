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
export const t = (locale === "zh-CN" ? zh : en) as Messages;

/** Compile-time guard: en must stay key-compatible with zh. */
type _AssertSameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : never
  : never;
const _enCompat: _AssertSameKeys<typeof zh, typeof en> = true;
void _enCompat;

export { zh, en, locale, resolveUiLocale };
export {
  detectSystemLanguage,
  resolveMonacoNls,
  type MonacoNlsId,
  type UiLocale,
} from "./locale";

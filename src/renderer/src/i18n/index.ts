import { reactive, ref } from "vue";
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

function messagesFor(next: UiLocale): Messages {
  return (next === "zh-CN" ? zh : en) as Messages;
}

/** 当前界面语言；切换语言时实时更新，无需重载页面。 */
const locale = ref<UiLocale>(resolveActiveLocale());

/** Active UI strings — Chinese when zh*, otherwise English (or user override). */
export const t = reactive({
  ...messagesFor(locale.value),
}) as Messages;

/** 运行时切换界面语言：替换文案，模板立即跟随，不出现加载页。 */
export function applyUiLocale(next: UiLocale): void {
  if (next === locale.value) return;
  locale.value = next;
  Object.assign(t, messagesFor(next));
}

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

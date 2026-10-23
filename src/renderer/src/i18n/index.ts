import { en } from "./en";
import { zh } from "./zh-CN";
import { detectSystemLanguage, resolveUiLocale, type UiLocale } from "./locale";
import * as prefs from "@renderer/utils/prefs";

export type Messages = typeof zh;

function readStoredLocalePreference(): "system" | "zh-CN" | "en" {
  try {
    const raw = prefs.getItem("pi-desktop:locale-preference");
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

let currentLocale: UiLocale = resolveActiveLocale();

/**
 * Active UI strings — Chinese when zh*, otherwise English (or user override).
 * 对象原地替换，React 组件通过 useI18n() 订阅变化后重渲染。
 */
export const t: Messages = { ...messagesFor(currentLocale) };

const listeners = new Set<() => void>();

/** 当前生效的界面语言。 */
export function getLocale(): UiLocale {
  return currentLocale;
}

/** 订阅界面语言变化，返回解绑函数。 */
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 运行时切换界面语言：替换文案，组件立即跟随，不出现加载页。 */
export function applyUiLocale(next: UiLocale): void {
  if (next === currentLocale) return;
  currentLocale = next;
  Object.assign(t, messagesFor(next));
  for (const listener of listeners) listener();
}

/** Compile-time guard: en must stay key-compatible with zh. */
type _AssertSameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : never
  : never;
const _enCompat: _AssertSameKeys<typeof zh, typeof en> = true;
void _enCompat;

export { zh, en, resolveUiLocale };
export {
  detectSystemLanguage,
  resolveMonacoNls,
  type MonacoNlsId,
  type UiLocale,
} from "./locale";

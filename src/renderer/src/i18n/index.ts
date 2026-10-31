import { en } from "./en";
import { ja } from "./ja";
import { zh } from "./zh-CN";
import { zhTW } from "./zh-TW";
import { detectSystemLanguage, isUiLocale, resolveUiLocale, type UiLocale } from "./locale";
import * as prefs from "@renderer/utils/prefs";

/** 去掉 `as const` 的字面量类型：各语言文案值必然不同，只有键与函数签名要保持一致。 */
type WidenStrings<T> = T extends string ? string : T;
export type Messages = { [K in keyof typeof zh]: WidenStrings<(typeof zh)[K]> };

const MESSAGES: Record<UiLocale, Messages> = {
  "zh-CN": zh,
  "zh-TW": zhTW,
  ja,
  en,
};

function readStoredLocalePreference(): "system" | UiLocale {
  try {
    const raw = prefs.getItem("pi-desktop:locale-preference");
    if (raw === "system" || isUiLocale(raw)) return raw;
  } catch {
    // ignore
  }
  return "system";
}

function resolveActiveLocale(): UiLocale {
  const pref = readStoredLocalePreference();
  if (pref !== "system") return pref;
  return resolveUiLocale(detectSystemLanguage());
}

function messagesFor(next: UiLocale): Messages {
  return MESSAGES[next];
}

let currentLocale: UiLocale = resolveActiveLocale();

/**
 * Active UI strings — Chinese when zh*, otherwise English (or user override).
 * 对象原地替换，React 组件通过 useI18n() 订阅变化后重渲染。
 */
export const t: Messages = { ...messagesFor(currentLocale) };

/**
 * useI18n 的快照：每个组件渲染都拷贝整张文案表（几百个键）太贵，
 * 这里只在语言切换时重建一次，组件之间共享同一个引用。
 */
let currentSnapshot: Messages = t;

/** 当前文案快照（useSyncExternalStore 的 getSnapshot，引用稳定）。 */
export function getMessages(): Messages {
  return currentSnapshot;
}

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
  currentSnapshot = { ...t };
  for (const listener of listeners) listener();
}

/** Compile-time guard: every locale must stay key-compatible with zh. */
type _AssertSameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : never
  : never;
const _enCompat: _AssertSameKeys<typeof zh, typeof en> = true;
const _zhTWCompat: _AssertSameKeys<typeof zh, typeof zhTW> = true;
const _jaCompat: _AssertSameKeys<typeof zh, typeof ja> = true;
void _enCompat;
void _zhTWCompat;
void _jaCompat;

export { zh, zhTW, ja, en, resolveUiLocale };
export {
  detectSystemLanguage,
  isUiLocale,
  type UiLocale,
} from "./locale";
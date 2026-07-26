import { en } from "./en";
import { zh } from "./zh-CN";
import { resolveUiLocale, type UiLocale } from "./locale";

export type Messages = typeof zh;

const locale: UiLocale = resolveUiLocale();

/** Active UI strings — Chinese when system language is zh*, otherwise English. */
export const t: Messages = (locale === "zh-CN" ? zh : en) as Messages;

export { zh, en, locale, resolveUiLocale };
export {
  detectSystemLanguage,
  resolveMonacoNls,
  type MonacoNlsId,
  type UiLocale,
} from "./locale";

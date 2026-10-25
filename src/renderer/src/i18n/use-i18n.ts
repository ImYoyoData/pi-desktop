import { useMemo, useSyncExternalStore } from "react";
import {
  getLocale,
  subscribeLocale,
  t,
  type Messages,
  type UiLocale,
} from "./index";

/**
 * 订阅界面语言，返回当前文案表。
 *
 * 返回的是当前语言的快照副本：共享的 `t` 是原地替换内容的稳定对象，
 * 直接把它放进 useMemo 依赖里，切换语言时 memo 不会重算、界面仍显示旧文案。
 * 副本的身份随语言变化，依赖 `t` 的 memo 才会跟着刷新。
 */
export function useI18n(): Messages {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  return useMemo(() => ({ ...t }), [locale]);
}

/** 订阅界面语言，返回当前生效的语言标识。 */
export function useUiLocale(): UiLocale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

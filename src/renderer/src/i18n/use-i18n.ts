import { useSyncExternalStore } from "react";
import {
  getLocale,
  subscribeLocale,
  t,
  type Messages,
  type UiLocale,
} from "./index";

/**
 * 订阅界面语言，返回当前文案表。
 * 语言切换时组件重渲染，模板里的 t.xxx 立即跟随。
 */
export function useI18n(): Messages {
  useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  return t;
}

/** 订阅界面语言，返回当前生效的语言标识。 */
export function useUiLocale(): UiLocale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

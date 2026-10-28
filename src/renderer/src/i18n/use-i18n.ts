import { useSyncExternalStore } from "react";
import {
  getLocale,
  getMessages,
  subscribeLocale,
  type Messages,
  type UiLocale,
} from "./index";

/**
 * 订阅界面语言，返回当前文案表。
 *
 * 返回的是语言切换时重建的快照：引用随语言变化，依赖它的 memo 会跟着刷新；
 * 同一语言下引用恒定，挂载再多的组件也不重复拷贝整张文案表。
 */
export function useI18n(): Messages {
  return useSyncExternalStore(subscribeLocale, getMessages, getMessages);
}

/** 订阅界面语言，返回当前生效的语言标识。 */
export function useUiLocale(): UiLocale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

import { create } from "zustand";
import { toIpcPlain } from "../../../shared/protocol";
import {
  DEFAULT_RETRY_SETTINGS,
  type RetrySettings,
} from "../../../shared/retry-settings";

type RetryState = {
  settings: RetrySettings;
  load: () => Promise<void>;
  save: (next: RetrySettings) => Promise<void>;
  /** 另一端改了设置后重新读取并应用。 */
  refresh: () => Promise<void>;
};

/** 「重试」设置：主进程持久化到 settings.json，渲染端与 worker 共用同一份值。 */
export const useRetryStore = create<RetryState>()((set) => {
  let loading: Promise<void> | null = null;

  function load(): Promise<void> {
    loading ??= (async () => {
      try {
        set({ settings: await window.api.retry.get() });
      } catch {
        // 读取失败时保持默认值
      }
    })();
    return loading;
  }

  async function save(next: RetrySettings): Promise<void> {
    set({ settings: await window.api.retry.set(toIpcPlain(next)) });
  }

  async function refresh(): Promise<void> {
    try {
      set({ settings: await window.api.retry.get() });
    } catch {
      // 读取失败时保持当前值
    }
  }

  return { settings: { ...DEFAULT_RETRY_SETTINGS }, load, save, refresh };
});

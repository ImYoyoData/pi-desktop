import { defineStore } from "pinia";
import { ref } from "vue";
import {
  DEFAULT_RETRY_SETTINGS,
  type RetrySettings,
} from "../../../shared/retry-settings";

/** 「重试」设置：主进程持久化到 settings.json，渲染端与 worker 共用同一份值。 */
export const useRetryStore = defineStore("retry", () => {
  const settings = ref<RetrySettings>({ ...DEFAULT_RETRY_SETTINGS });
  let loading: Promise<void> | null = null;
  let subscribed = false;

  function load(): Promise<void> {
    loading ??= (async () => {
      if (!subscribed) {
        subscribed = true;
        window.api.retry.onChanged((next) => {
          settings.value = next;
        });
      }
      try {
        settings.value = await window.api.retry.get();
      } catch {
        // 读取失败时保持默认值
      }
    })();
    return loading;
  }

  async function save(next: RetrySettings): Promise<void> {
    settings.value = await window.api.retry.set(next);
  }

  return { settings, load, save };
});

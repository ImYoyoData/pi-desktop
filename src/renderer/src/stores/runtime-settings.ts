import { defineStore } from "pinia";
import { ref } from "vue";
import { toIpcPlain } from "../../../shared/protocol";
import {
  DEFAULT_RUNTIME_SETTINGS,
  type RuntimeSettings,
} from "../../../shared/runtime-settings";

/** 「运行」设置：主进程持久化到 settings.json，渲染端与 worker 共用同一份值。 */
export const useRuntimeSettingsStore = defineStore("runtime-settings", () => {
  const settings = ref<RuntimeSettings>({ ...DEFAULT_RUNTIME_SETTINGS });
  let loading: Promise<void> | null = null;
  let subscribed = false;

  /** force=true 时重新读盘（保存失败后回滚界面显示）。 */
  function load(force = false): Promise<void> {
    if (force) loading = null;
    loading ??= (async () => {
      if (!subscribed) {
        subscribed = true;
        window.api.runtime.onChanged((next) => {
          settings.value = next;
        });
      }
      try {
        settings.value = await window.api.runtime.get();
      } catch {
        // 读取失败时保持默认值
      }
    })();
    return loading;
  }

  async function save(next: RuntimeSettings): Promise<void> {
    // Vue 响应式代理不能结构化克隆，先转成普通对象再发 IPC。
    settings.value = await window.api.runtime.set(toIpcPlain(next));
  }

  return { settings, load, save };
});

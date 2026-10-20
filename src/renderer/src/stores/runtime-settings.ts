import { create } from "zustand";
import { toIpcPlain } from "../../../shared/protocol";
import {
  DEFAULT_RUNTIME_SETTINGS,
  type RuntimeSettings,
} from "../../../shared/runtime-settings";

type RuntimeSettingsState = {
  settings: RuntimeSettings;
  load: (force?: boolean) => Promise<void>;
  save: (next: RuntimeSettings) => Promise<void>;
};

/** 「运行」设置：主进程持久化到 settings.json，渲染端与 worker 共用同一份值。 */
export const useRuntimeSettingsStore = create<RuntimeSettingsState>()((set) => {
  let loading: Promise<void> | null = null;
  let subscribed = false;

  /** force=true 时重新读盘（保存失败后回滚界面显示）。 */
  function load(force = false): Promise<void> {
    if (force) loading = null;
    loading ??= (async () => {
      if (!subscribed) {
        subscribed = true;
        window.api.runtime.onChanged((next) => {
          set({ settings: next });
        });
      }
      try {
        set({ settings: await window.api.runtime.get() });
      } catch {
        // 读取失败时保持默认值
      }
    })();
    return loading;
  }

  async function save(next: RuntimeSettings): Promise<void> {
    set({ settings: await window.api.runtime.set(toIpcPlain(next)) });
  }

  return { settings: { ...DEFAULT_RUNTIME_SETTINGS }, load, save };
});

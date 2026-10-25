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
  /** 另一端改了设置后重新读取并应用。 */
  refresh: () => Promise<void>;
};

/** 「运行」设置：主进程持久化到 settings.json，渲染端与 worker 共用同一份值。 */
export const useRuntimeSettingsStore = create<RuntimeSettingsState>()((set) => {
  let loading: Promise<void> | null = null;

  /** force=true 时重新读盘（保存失败后回滚界面显示）。 */
  function load(force = false): Promise<void> {
    if (force) loading = null;
    loading ??= (async () => {
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

  async function refresh(): Promise<void> {
    try {
      set({ settings: await window.api.runtime.get() });
    } catch {
      // 读取失败时保持当前值
    }
  }

  return { settings: { ...DEFAULT_RUNTIME_SETTINGS }, load, save, refresh };
});

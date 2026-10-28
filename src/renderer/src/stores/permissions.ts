import { create } from "zustand";
import {
  DEFAULT_PERMISSION_SETTINGS,
  type PermissionSettings,
} from "../../../shared/permissions";

type PermissionsState = {
  settings: PermissionSettings;
  load: () => Promise<void>;
  save: (next: PermissionSettings) => Promise<void>;
};

/** 工具审批档位：主进程落到 settings.json，worker 每次调用都由 main 判定。 */
export const usePermissionsStore = create<PermissionsState>()((set) => {
  let loading: Promise<void> | null = null;

  function load(): Promise<void> {
    loading ??= (async () => {
      try {
        set({ settings: await window.api.permissions.get() });
      } catch {
        // 读取失败时保持默认档
      }
    })();
    return loading;
  }

  async function save(next: PermissionSettings): Promise<void> {
    set({ settings: await window.api.permissions.set(next) });
  }

  return { settings: { ...DEFAULT_PERMISSION_SETTINGS }, load, save };
});

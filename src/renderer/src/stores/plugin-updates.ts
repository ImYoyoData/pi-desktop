import { create } from "zustand";
import type { PluginUpdateProgress, PluginVersionInfo } from "../../../shared/pi-market";

type PluginUpdatesState = {
  checking: boolean;
  versions: Record<string, PluginVersionInfo>;
  progress: Record<string, PluginUpdateProgress>;
  upgrading: Set<string>;
  check: (root?: string) => Promise<PluginVersionInfo[] | null>;
  upgrade: (
    id: string,
    source: string,
    scope: "global" | "project",
    root?: string,
  ) => Promise<boolean>;
};

/** 插件检查更新与升级状态：脱离设置页组件存活，切换页面或退出设置后仍保留。 */
export const usePluginUpdatesStore = create<PluginUpdatesState>()((set, get) => {
  // 进度监听跟随 store 生命周期，设置页卸载期间继续记录升级进度。
  window.api.plugins.onUpdateProgress((next) => {
    const id = `${next.scope}:${next.source}`;
    if (next.phase === "done" || next.phase === "error") {
      const rest = { ...get().progress };
      delete rest[id];
      set({ progress: rest });
      return;
    }
    set({ progress: { ...get().progress, [id]: next } });
  });

  function setUpgrading(id: string, upgradingNow: boolean): void {
    const next = new Set(get().upgrading);
    if (upgradingNow) next.add(id);
    else next.delete(id);
    set({ upgrading: next });
  }

  /** 检查插件版本：结果按 `${scope}:${source}` 缓存供版本徽标与升级按钮使用。 */
  async function check(root?: string): Promise<PluginVersionInfo[] | null> {
    if (get().checking) return null;
    set({ checking: true });
    try {
      const list = await window.api.plugins.checkUpdates(root);
      const next: Record<string, PluginVersionInfo> = {};
      for (const info of list) next[`${info.scope}:${info.source}`] = info;
      set({ versions: next });
      return list;
    } finally {
      set({ checking: false });
    }
  }

  /** 升级单个插件：就地更新该行版本；返回 false 表示无需升级或已在升级中。 */
  async function upgrade(
    id: string,
    source: string,
    scope: "global" | "project",
    root?: string,
  ): Promise<boolean> {
    const info = get().versions[id];
    if (!info?.hasUpdate || get().upgrading.has(id)) return false;
    setUpgrading(id, true);
    try {
      await window.api.plugins.update(source, scope, root);
      const currentVersion = info.latestVersion ?? info.currentVersion;
      set((state) => ({
        versions: {
          ...state.versions,
          [id]: { ...info, currentVersion, latestVersion: currentVersion, hasUpdate: false },
        },
      }));
      return true;
    } finally {
      setUpgrading(id, false);
    }
  }

  return { checking: false, versions: {}, progress: {}, upgrading: new Set<string>(), check, upgrade };
});

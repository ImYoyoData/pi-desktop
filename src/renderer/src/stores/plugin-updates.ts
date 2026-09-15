import { defineStore } from "pinia";
import { ref } from "vue";
import type { PluginUpdateProgress, PluginVersionInfo } from "../../../shared/pi-market";

/** 插件检查更新与升级状态：脱离设置页组件存活，切换页面或退出设置后仍保留。 */
export const usePluginUpdatesStore = defineStore("pluginUpdates", () => {
  const checking = ref(false);
  const versions = ref<Record<string, PluginVersionInfo>>({});
  const progress = ref<Record<string, PluginUpdateProgress>>({});
  const upgrading = ref(new Set<string>());

  // 进度监听跟随 store 生命周期，设置页卸载期间继续记录升级进度。
  window.api.plugins.onUpdateProgress((next) => {
    const id = `${next.scope}:${next.source}`;
    if (next.phase === "done" || next.phase === "error") {
      const rest = { ...progress.value };
      delete rest[id];
      progress.value = rest;
      return;
    }
    progress.value = { ...progress.value, [id]: next };
  });

  /** 检查插件版本：结果按 `${scope}:${source}` 缓存供版本徽标与升级按钮使用。 */
  async function check(root?: string): Promise<PluginVersionInfo[] | null> {
    if (checking.value) return null;
    checking.value = true;
    try {
      const list = await window.api.plugins.checkUpdates(root);
      const next: Record<string, PluginVersionInfo> = {};
      for (const info of list) next[`${info.scope}:${info.source}`] = info;
      versions.value = next;
      return list;
    } finally {
      checking.value = false;
    }
  }

  function setUpgrading(id: string, upgradingNow: boolean): void {
    const next = new Set(upgrading.value);
    if (upgradingNow) next.add(id);
    else next.delete(id);
    upgrading.value = next;
  }

  /** 升级单个插件：就地更新该行版本；返回 false 表示无需升级或已在升级中。 */
  async function upgrade(
    id: string,
    source: string,
    scope: "global" | "project",
    root?: string,
  ): Promise<boolean> {
    const info = versions.value[id];
    if (!info?.hasUpdate || upgrading.value.has(id)) return false;
    setUpgrading(id, true);
    try {
      await window.api.plugins.update(source, scope, root);
      const currentVersion = info.latestVersion ?? info.currentVersion;
      versions.value = {
        ...versions.value,
        [id]: { ...info, currentVersion, latestVersion: currentVersion, hasUpdate: false },
      };
      return true;
    } finally {
      setUpgrading(id, false);
    }
  }

  return { checking, versions, progress, upgrading, check, upgrade };
});

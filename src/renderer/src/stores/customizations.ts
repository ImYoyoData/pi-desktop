import { defineStore } from "pinia";
import { ref } from "vue";
import { emptyCustomizations, type CustomizationsSnapshot } from "../../../shared/customizations";
import { useWorkspaceStore } from "@renderer/stores/workspace";

/** 智能体设置页数据：按工作区加载一次，工作区切换时重取。 */
export const useCustomizationsStore = defineStore("customizations", () => {
  const snapshot = ref<CustomizationsSnapshot>(emptyCustomizations(null));
  const loading = ref(false);
  const error = ref("");
  let loadedRoot: string | null | undefined;

  async function load(force = false): Promise<void> {
    const workspace = useWorkspaceStore();
    const root = workspace.root ?? undefined;
    if (!force && loadedRoot === (root ?? null)) return;
    loading.value = true;
    error.value = "";
    try {
      const data = await window.api.customizations.list(root);
      snapshot.value = data;
      loadedRoot = data.root;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  }

  /** 本地更新 MCP 开关状态，避免重新加载整份快照。 */
  function setMcpEnabled(id: string, enabled: boolean): void {
    snapshot.value = {
      ...snapshot.value,
      mcp: snapshot.value.mcp.map((item) =>
        item.id === id ? { ...item, enabled } : item,
      ),
    };
  }

  /** 从本地快照中移除已删除的 MCP 服务器。 */
  function removeMcp(id: string): void {
    snapshot.value = {
      ...snapshot.value,
      mcp: snapshot.value.mcp.filter((item) => item.id !== id),
    };
  }

  /** 本地更新插件启用状态，避免重新加载整份快照。 */
  function setPluginEnabled(id: string, enabled: boolean): void {
    snapshot.value = {
      ...snapshot.value,
      plugins: snapshot.value.plugins.map((item) =>
        item.id === id ? { ...item, enabled } : item,
      ),
    };
  }

  return { snapshot, loading, error, load, setMcpEnabled, removeMcp, setPluginEnabled };
});

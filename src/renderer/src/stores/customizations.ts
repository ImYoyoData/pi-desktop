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
    const initial = loadedRoot !== (root ?? null);
    if (initial) loading.value = true;
    error.value = "";
    try {
      const data = await window.api.customizations.list(root, force);
      snapshot.value = data;
      loadedRoot = data.root;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  }

  /** 订阅主进程推送的最新快照：后台重扫完成后自动替换本地数据。 */
  function init(): () => void {
    return window.api.customizations.onUpdated((data) => {
      const workspace = useWorkspaceStore();
      if ((data.root ?? null)?.toLowerCase() !== (workspace.root ?? null)?.toLowerCase()) return;
      snapshot.value = data;
      loadedRoot = data.root;
    });
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

  /** 本地更新技能启用状态，避免重新加载整份快照。 */
  function setSkillEnabled(id: string, enabled: boolean): void {
    snapshot.value = {
      ...snapshot.value,
      skills: snapshot.value.skills.map((item) =>
        item.id === id ? { ...item, enabled } : item,
      ),
    };
  }

  /** 本地更新智能体/提示的启停状态与重命名后的路径，避免重新加载整份快照。 */
  function setFileItemEnabled(
    kind: "agents" | "prompts",
    id: string,
    enabled: boolean,
    filePath: string,
  ): void {
    const items = snapshot.value[kind].map((item) =>
      item.id === id ? { ...item, id: filePath, filePath, enabled } : item,
    );
    snapshot.value =
      kind === "agents"
        ? { ...snapshot.value, agents: items }
        : { ...snapshot.value, prompts: items };
  }

  /** 从本地快照中移除已删除的技能/智能体/提示。 */
  function removeFileItem(kind: "skills" | "agents" | "prompts", id: string): void {
    const items = snapshot.value[kind].filter((item) => item.id !== id);
    snapshot.value =
      kind === "skills"
        ? { ...snapshot.value, skills: items }
        : kind === "agents"
          ? { ...snapshot.value, agents: items }
          : { ...snapshot.value, prompts: items };
  }

  return {
    snapshot,
    loading,
    error,
    load,
    init,
    setMcpEnabled,
    removeMcp,
    setPluginEnabled,
    setSkillEnabled,
    setFileItemEnabled,
    removeFileItem,
  };
});

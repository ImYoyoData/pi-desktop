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

  return { snapshot, loading, error, load };
});

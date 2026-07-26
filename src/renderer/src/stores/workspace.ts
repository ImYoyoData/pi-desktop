import { defineStore } from "pinia";
import { ref } from "vue";

export const useWorkspaceStore = defineStore("workspace", () => {
  const root = ref<string | null>(null);
  const recent = ref<string[]>([]);

  async function getWorkspace(): Promise<string | null> {
    root.value = await window.api.workspace.get();
    return root.value;
  }

  async function openWorkspace(): Promise<string | null> {
    root.value = await window.api.workspace.open();
    await listRecent();
    return root.value;
  }

  async function openWorkspacePath(workspaceRoot: string): Promise<string | null> {
    root.value = await window.api.workspace.openPath(workspaceRoot);
    await listRecent();
    return root.value;
  }

  async function listRecent(): Promise<string[]> {
    recent.value = await window.api.workspace.listRecent();
    return recent.value;
  }

  return {
    root,
    recent,
    getWorkspace,
    openWorkspace,
    openWorkspacePath,
    listRecent,
  };
});

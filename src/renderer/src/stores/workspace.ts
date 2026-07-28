import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { useRightTabsStore } from "@renderer/stores/right-tabs";

export const useWorkspaceStore = defineStore("workspace", () => {
  const root = ref<string | null>(null);
  const recent = ref<string[]>([]);

  /**
   * Watcher lifecycle is owned by main (workspace-ipc).
   * On switch we still ask main to re-sync, and drop old-workspace preview tabs
   * so we only care about files under the current root.
   */
  function onRootChanged(next: string | null, prev: string | null): void {
    if (next === prev) return;
    const tabs = useRightTabsStore();
    tabs.switchWorkspace(prev, next);
    if (next) void window.api.fs.watch(next);
    else void window.api.fs.unwatch();
  }

  watch(root, (next, prev) => {
    onRootChanged(next, prev ?? null);
  });

  watch(
    () => {
      const tabs = useRightTabsStore();
      return [tabs.tabs, tabs.activeId] as const;
    },
    () => {
      useRightTabsStore().persistTabs(root.value);
    },
    { deep: true },
  );

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

  async function removeRecent(workspaceRoot: string): Promise<void> {
    const next = await window.api.workspace.removeRecent(workspaceRoot);
    root.value = next.root;
    recent.value = next.recent;
  }

  async function reorderRecent(order: string[]): Promise<string[]> {
    recent.value = await window.api.workspace.reorderRecent(order);
    return recent.value;
  }

  async function revealInFolder(workspaceRoot: string): Promise<void> {
    await window.api.workspace.revealInFolder(workspaceRoot);
  }

  return {
    root,
    recent,
    getWorkspace,
    openWorkspace,
    openWorkspacePath,
    listRecent,
    removeRecent,
    reorderRecent,
    revealInFolder,
  };
});

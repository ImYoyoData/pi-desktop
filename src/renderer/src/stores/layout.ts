import { defineStore } from "pinia";
import { ref } from "vue";
import {
  clampPanelWidth,
  DEFAULT_LAYOUT,
  readLayout,
  writeLayout,
} from "@renderer/stores/layout-utils";

export { clampPanelWidth, readLayout, writeLayout } from "@renderer/stores/layout-utils";
export type { PersistedLayout } from "@renderer/stores/layout-utils";

export const useLayoutStore = defineStore("layout", () => {
  const workspaceRoot = ref<string | null>(null);
  const leftWidth = ref(DEFAULT_LAYOUT.leftWidth);
  const rightWidth = ref(DEFAULT_LAYOUT.rightWidth);
  const leftCollapsed = ref(false);
  const rightCollapsed = ref(false);

  function persist(): void {
    if (!workspaceRoot.value) {
      return;
    }
    writeLayout(workspaceRoot.value, {
      leftWidth: leftWidth.value,
      rightWidth: rightWidth.value,
      leftCollapsed: leftCollapsed.value,
      rightCollapsed: rightCollapsed.value,
    });
  }

  function loadForWorkspace(root: string): void {
    workspaceRoot.value = root;
    const data = readLayout(root);
    leftWidth.value = data.leftWidth;
    rightWidth.value = data.rightWidth;
    leftCollapsed.value = data.leftCollapsed;
    rightCollapsed.value = data.rightCollapsed;
  }

  function setLeftWidth(px: number): void {
    leftWidth.value = clampPanelWidth(px);
    persist();
  }

  function setRightWidth(px: number): void {
    rightWidth.value = clampPanelWidth(px);
    persist();
  }

  function toggleLeftCollapsed(): void {
    leftCollapsed.value = !leftCollapsed.value;
    persist();
  }

  function toggleRightCollapsed(): void {
    rightCollapsed.value = !rightCollapsed.value;
    persist();
  }

  return {
    workspaceRoot,
    leftWidth,
    rightWidth,
    leftCollapsed,
    rightCollapsed,
    loadForWorkspace,
    setLeftWidth,
    setRightWidth,
    toggleLeftCollapsed,
    toggleRightCollapsed,
  };
});

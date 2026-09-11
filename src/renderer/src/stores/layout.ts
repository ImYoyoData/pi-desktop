import { defineStore } from "pinia";
import { ref } from "vue";
import {
  clampPanePercent,
  clampPanelHeight,
  clampPercent,
  DEFAULT_LAYOUT,
  readLayout,
  writeLayout,
} from "@renderer/stores/layout-utils";

export {
  clampPanelHeight,
  clampPanelWidth,
  clampPanePercent,
  readLayout,
  writeLayout,
} from "@renderer/stores/layout-utils";
export type { PersistedLayout } from "@renderer/stores/layout-utils";

export const useLayoutStore = defineStore("layout", () => {
  const workspaceRoot = ref<string | null>(null);
  const leftSize = ref(DEFAULT_LAYOUT.leftSize);
  const centerSize = ref(DEFAULT_LAYOUT.centerSize);
  const rightSize = ref(DEFAULT_LAYOUT.rightSize);
  const leftCollapsed = ref(false);
  const rightCollapsed = ref(DEFAULT_LAYOUT.rightCollapsed);
  const leftFilesSize = ref(DEFAULT_LAYOUT.leftFilesSize);
  const bottomSize = ref(DEFAULT_LAYOUT.bottomSize);
  const bottomCollapsed = ref(DEFAULT_LAYOUT.bottomCollapsed);

  function persist(): void {
    if (!workspaceRoot.value) {
      return;
    }
    writeLayout(workspaceRoot.value, {
      leftSize: leftSize.value,
      centerSize: centerSize.value,
      rightSize: rightSize.value,
      leftCollapsed: leftCollapsed.value,
      rightCollapsed: rightCollapsed.value,
      leftFilesSize: leftFilesSize.value,
      bottomSize: bottomSize.value,
      bottomCollapsed: bottomCollapsed.value,
    });
  }

  function loadForWorkspace(root: string): void {
    workspaceRoot.value = root;
    const data = readLayout(root);
    leftSize.value = data.leftSize;
    centerSize.value = data.centerSize;
    rightSize.value = data.rightSize;
    leftCollapsed.value = data.leftCollapsed;
    rightCollapsed.value = data.rightCollapsed;
    leftFilesSize.value = data.leftFilesSize;
    bottomSize.value = data.bottomSize;
    bottomCollapsed.value = data.bottomCollapsed;
  }

  function setLeftSize(pct: number): void {
    leftSize.value = clampPanePercent(pct);
    persist();
  }

  function setCenterSize(pct: number): void {
    centerSize.value = clampPanePercent(pct);
    persist();
  }

  function setRightSize(pct: number): void {
    rightSize.value = clampPanePercent(pct);
    persist();
  }

  function setPaneSizes(left: number, center: number, right: number): void {
    leftSize.value = clampPanePercent(left);
    centerSize.value = clampPanePercent(center);
    rightSize.value = clampPanePercent(right);
    persist();
  }

  function setLeftFilesSize(percent: number): void {
    leftFilesSize.value = clampPercent(percent);
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

  /** Dragging the splitter implies a visible panel. */
  function setBottomSize(percent: number): void {
    bottomSize.value = clampPanelHeight(percent);
    bottomCollapsed.value = false;
    persist();
  }

  function toggleBottomCollapsed(): void {
    bottomCollapsed.value = !bottomCollapsed.value;
    persist();
  }

  return {
    workspaceRoot,
    leftSize,
    centerSize,
    rightSize,
    leftCollapsed,
    rightCollapsed,
    leftFilesSize,
    bottomSize,
    bottomCollapsed,
    loadForWorkspace,
    setLeftSize,
    setCenterSize,
    setRightSize,
    setPaneSizes,
    setLeftFilesSize,
    setBottomSize,
    toggleLeftCollapsed,
    toggleRightCollapsed,
    toggleBottomCollapsed,
  };
});

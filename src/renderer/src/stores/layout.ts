import { defineStore } from "pinia";
import { ref } from "vue";
import {
  clampPanePercent,
  clampPanelHeight,
  DEFAULT_LAYOUT,
  readLayout,
  writeLayout,
  type CenterView,
} from "@renderer/stores/layout-utils";

export {
  clampPanelHeight,
  clampPanelWidth,
  clampPanePercent,
  readLayout,
  writeLayout,
} from "@renderer/stores/layout-utils";
export type { CenterView, PersistedLayout } from "@renderer/stores/layout-utils";

export const useLayoutStore = defineStore("layout", () => {
  const workspaceRoot = ref<string | null>(null);
  const leftSize = ref(DEFAULT_LAYOUT.leftSize);
  const centerSize = ref(DEFAULT_LAYOUT.centerSize);
  const rightSize = ref(DEFAULT_LAYOUT.rightSize);
  const leftCollapsed = ref(false);
  const rightCollapsed = ref(DEFAULT_LAYOUT.rightCollapsed);
  const bottomSize = ref(DEFAULT_LAYOUT.bottomSize);
  const bottomCollapsed = ref(DEFAULT_LAYOUT.bottomCollapsed);
  /**
   * Maximize Editor Area — the right pane hosts the editors (diffs, previews),
   * so maximizing collapses the left sidebar + chat column + bottom panel and
   * lets the right pane take over the window; restoring replays the exact
   * pre-maximize layout.
   */
  const editorMaximized = ref(false);
  /** 中央区域当前视图及智能体设置页状态。 */
  const centerView = ref<CenterView>(DEFAULT_LAYOUT.centerView);
  const customizeSection = ref(DEFAULT_LAYOUT.customizeSection);

  type PreMaximizeState = {
    leftCollapsed: boolean;
    rightCollapsed: boolean;
    bottomCollapsed: boolean;
    leftSize: number;
    centerSize: number;
    rightSize: number;
    bottomSize: number;
  };
  let preMaximizeState: PreMaximizeState | null = null;

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
      bottomSize: bottomSize.value,
      bottomCollapsed: bottomCollapsed.value,
      centerView: centerView.value,
      customizeSection: customizeSection.value,
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
    bottomSize.value = data.bottomSize;
    bottomCollapsed.value = data.bottomCollapsed;
    centerView.value = data.centerView;
    customizeSection.value = data.customizeSection;
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

  function toggleLeftCollapsed(): void {
    leftCollapsed.value = !leftCollapsed.value;
    persist();
  }

  function toggleRightCollapsed(): void {
    if (editorMaximized.value) {
      toggleEditorMaximized();
      if (!rightCollapsed.value) {
        rightCollapsed.value = true;
        persist();
      }
      return;
    }
    rightCollapsed.value = !rightCollapsed.value;
    persist();
  }

  /** 在中央区域打开智能体设置页（退出编辑器区最大化）。 */
  function openCustomize(section: string): void {
    if (editorMaximized.value) toggleEditorMaximized();
    if (section) customizeSection.value = section;
    centerView.value = "customize";
    persist();
  }

  /** 返回聊天视图。 */
  function showChat(): void {
    centerView.value = "chat";
    persist();
  }

  function setCustomizeSection(section: string): void {
    customizeSection.value = section;
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

  function toggleEditorMaximized(): void {
    if (!editorMaximized.value) {
      preMaximizeState = {
        leftCollapsed: leftCollapsed.value,
        rightCollapsed: rightCollapsed.value,
        bottomCollapsed: bottomCollapsed.value,
        leftSize: leftSize.value,
        centerSize: centerSize.value,
        rightSize: rightSize.value,
        bottomSize: bottomSize.value,
      };
      leftCollapsed.value = true;
      rightCollapsed.value = false;
      bottomCollapsed.value = true;
      editorMaximized.value = true;
      persist();
      return;
    }
    const pre = preMaximizeState;
    editorMaximized.value = false;
    preMaximizeState = null;
    if (pre) {
      leftCollapsed.value = pre.leftCollapsed;
      rightCollapsed.value = pre.rightCollapsed;
      bottomCollapsed.value = pre.bottomCollapsed;
      leftSize.value = pre.leftSize;
      centerSize.value = pre.centerSize;
      rightSize.value = pre.rightSize;
      bottomSize.value = pre.bottomSize;
    }
    persist();
  }

  return {
    workspaceRoot,
    leftSize,
    centerSize,
    rightSize,
    leftCollapsed,
    rightCollapsed,
    bottomSize,
    bottomCollapsed,
    editorMaximized,
    centerView,
    customizeSection,
    loadForWorkspace,
    setLeftSize,
    setCenterSize,
    setRightSize,
    setPaneSizes,
    setBottomSize,
    toggleLeftCollapsed,
    toggleRightCollapsed,
    toggleBottomCollapsed,
    toggleEditorMaximized,
    openCustomize,
    showChat,
    setCustomizeSection,
  };
});

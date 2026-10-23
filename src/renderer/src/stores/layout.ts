import { create } from "zustand";
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

type PreMaximizeState = {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  bottomCollapsed: boolean;
  leftSize: number;
  centerSize: number;
  rightSize: number;
  bottomSize: number;
};

type LayoutBase = {
  workspaceRoot: string | null;
  leftSize: number;
  centerSize: number;
  rightSize: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  bottomSize: number;
  bottomCollapsed: boolean;
  /**
   * Maximize Editor Area — the right pane hosts the editors (diffs, previews),
   * so maximizing collapses the left sidebar + chat column + bottom panel and
   * lets the right pane take over the window; restoring replays the exact
   * pre-maximize layout.
   */
  editorMaximized: boolean;
  /** 中央区域当前视图及智能体设置页状态。 */
  centerView: CenterView;
  customizeSection: string;
};

export type LayoutState = LayoutBase & {
  loadForWorkspace: (root: string) => void;
  setLeftSize: (pct: number) => void;
  setCenterSize: (pct: number) => void;
  setRightSize: (pct: number) => void;
  setPaneSizes: (left: number, center: number, right: number) => void;
  setBottomSize: (percent: number) => void;
  toggleLeftCollapsed: () => void;
  toggleRightCollapsed: () => void;
  toggleBottomCollapsed: () => void;
  toggleEditorMaximized: () => void;
  openCustomize: (section: string) => void;
  showChat: () => void;
  showPullRequests: () => void;
  setCustomizeSection: (section: string) => void;
};

export const useLayoutStore = create<LayoutState>()((set, get) => {
  let preMaximizeState: PreMaximizeState | null = null;

  function persist(): void {
    const state = get();
    if (!state.workspaceRoot) return;
    writeLayout(state.workspaceRoot, {
      leftSize: state.leftSize,
      centerSize: state.centerSize,
      rightSize: state.rightSize,
      leftCollapsed: state.leftCollapsed,
      rightCollapsed: state.rightCollapsed,
      bottomSize: state.bottomSize,
      bottomCollapsed: state.bottomCollapsed,
      centerView: state.centerView,
      customizeSection: state.customizeSection,
    });
  }

  function loadForWorkspace(root: string): void {
    const data = readLayout(root);
    set({
      workspaceRoot: root,
      leftSize: data.leftSize,
      centerSize: data.centerSize,
      rightSize: data.rightSize,
      leftCollapsed: data.leftCollapsed,
      rightCollapsed: data.rightCollapsed,
      bottomSize: data.bottomSize,
      bottomCollapsed: data.bottomCollapsed,
      centerView: data.centerView,
      customizeSection: data.customizeSection,
    });
  }

  function setLeftSize(pct: number): void {
    set({ leftSize: clampPanePercent(pct) });
    persist();
  }

  function setCenterSize(pct: number): void {
    set({ centerSize: clampPanePercent(pct) });
    persist();
  }

  function setRightSize(pct: number): void {
    set({ rightSize: clampPanePercent(pct) });
    persist();
  }

  function setPaneSizes(left: number, center: number, right: number): void {
    set({
      leftSize: clampPanePercent(left),
      centerSize: clampPanePercent(center),
      rightSize: clampPanePercent(right),
    });
    persist();
  }

  function toggleLeftCollapsed(): void {
    set((state) => ({ leftCollapsed: !state.leftCollapsed }));
    persist();
  }

  function toggleRightCollapsed(): void {
    if (get().editorMaximized) {
      get().toggleEditorMaximized();
      if (!get().rightCollapsed) {
        set({ rightCollapsed: true });
        persist();
      }
      return;
    }
    set((state) => ({ rightCollapsed: !state.rightCollapsed }));
    persist();
  }

  /** 在中央区域打开智能体设置页（退出编辑器区最大化）。 */
  function openCustomize(section: string): void {
    if (get().editorMaximized) get().toggleEditorMaximized();
    if (section) set({ customizeSection: section });
    set({ centerView: "customize" });
    persist();
  }

  /** 返回聊天视图。 */
  function showChat(): void {
    set({ centerView: "chat" });
    persist();
  }

  /** 在中央区域打开拉取请求视图。 */
  function showPullRequests(): void {
    if (get().editorMaximized) get().toggleEditorMaximized();
    set({ centerView: "pull-requests" });
    persist();
  }

  function setCustomizeSection(section: string): void {
    set({ customizeSection: section });
    persist();
  }

  /** Dragging the splitter implies a visible panel. */
  function setBottomSize(percent: number): void {
    set({ bottomSize: clampPanelHeight(percent), bottomCollapsed: false });
    persist();
  }

  function toggleBottomCollapsed(): void {
    set((state) => ({ bottomCollapsed: !state.bottomCollapsed }));
    persist();
  }

  function toggleEditorMaximized(): void {
    const state = get();
    if (!state.editorMaximized) {
      preMaximizeState = {
        leftCollapsed: state.leftCollapsed,
        rightCollapsed: state.rightCollapsed,
        bottomCollapsed: state.bottomCollapsed,
        leftSize: state.leftSize,
        centerSize: state.centerSize,
        rightSize: state.rightSize,
        bottomSize: state.bottomSize,
      };
      set({
        leftCollapsed: true,
        rightCollapsed: false,
        bottomCollapsed: true,
        editorMaximized: true,
      });
      persist();
      return;
    }
    const pre = preMaximizeState;
    preMaximizeState = null;
    set({
      editorMaximized: false,
      ...(pre
        ? {
            leftCollapsed: pre.leftCollapsed,
            rightCollapsed: pre.rightCollapsed,
            bottomCollapsed: pre.bottomCollapsed,
            leftSize: pre.leftSize,
            centerSize: pre.centerSize,
            rightSize: pre.rightSize,
            bottomSize: pre.bottomSize,
          }
        : {}),
    });
    persist();
  }

  return {
    workspaceRoot: null,
    leftSize: DEFAULT_LAYOUT.leftSize,
    centerSize: DEFAULT_LAYOUT.centerSize,
    rightSize: DEFAULT_LAYOUT.rightSize,
    leftCollapsed: false,
    rightCollapsed: DEFAULT_LAYOUT.rightCollapsed,
    bottomSize: DEFAULT_LAYOUT.bottomSize,
    bottomCollapsed: DEFAULT_LAYOUT.bottomCollapsed,
    editorMaximized: false,
    centerView: DEFAULT_LAYOUT.centerView,
    customizeSection: DEFAULT_LAYOUT.customizeSection,
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
    showPullRequests,
    setCustomizeSection,
  };
});

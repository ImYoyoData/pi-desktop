import { defineStore } from "pinia";
import { ref } from "vue";

export function clampPanelWidth(px: number, min = 180, max = 560): number {
  return Math.min(max, Math.max(min, px));
}

export interface PersistedLayout {
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

const DEFAULT_LAYOUT: PersistedLayout = {
  leftWidth: 240,
  rightWidth: 320,
  leftCollapsed: false,
  rightCollapsed: false,
};

export function layoutStorageKey(workspaceRoot: string): string {
  return `layout:${workspaceRoot}`;
}

export function readLayout(workspaceRoot: string): PersistedLayout {
  try {
    const raw = localStorage.getItem(layoutStorageKey(workspaceRoot));
    if (!raw) {
      return { ...DEFAULT_LAYOUT };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedLayout>;
    return {
      leftWidth: clampPanelWidth(parsed.leftWidth ?? DEFAULT_LAYOUT.leftWidth),
      rightWidth: clampPanelWidth(parsed.rightWidth ?? DEFAULT_LAYOUT.rightWidth),
      leftCollapsed: parsed.leftCollapsed ?? false,
      rightCollapsed: parsed.rightCollapsed ?? false,
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function writeLayout(workspaceRoot: string, state: PersistedLayout): void {
  localStorage.setItem(layoutStorageKey(workspaceRoot), JSON.stringify(state));
}

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

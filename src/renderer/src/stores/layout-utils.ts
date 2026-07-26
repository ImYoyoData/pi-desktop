export function clampPanelWidth(px: number, min = 180, max = 560): number {
  return Math.min(max, Math.max(min, px));
}

export interface PersistedLayout {
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

export const DEFAULT_LAYOUT: PersistedLayout = {
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

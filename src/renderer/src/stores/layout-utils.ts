export function clampPanelWidth(px: number, min = 180, max = 560): number {
  return Math.min(max, Math.max(min, px));
}

/** Clamp a horizontal pane size percentage (left / chat / right). */
export function clampPanePercent(value: number, min = 12, max = 70): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clampPercent(value: number, min = 22, max = 78): number {
  return Math.min(max, Math.max(min, value));
}

/** Bottom panel height as % of the chat column. */
export function clampPanelHeight(value: number, min = 18, max = 75): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export interface PersistedLayout {
  leftSize: number;
  centerSize: number;
  rightSize: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  /** Height % of the files pane within the left sidebar (sessions take the rest). */
  leftFilesSize: number;
  /** Height % of the bottom terminal panel within the chat column. */
  bottomSize: number;
  bottomCollapsed: boolean;
}

export const DEFAULT_LAYOUT: PersistedLayout = {
  leftSize: 20,
  centerSize: 30,
  rightSize: 50,
  leftCollapsed: false,
  rightCollapsed: false,
  leftFilesSize: 42,
  bottomSize: 30,
  bottomCollapsed: true,
};

export function layoutStorageKey(workspaceRoot: string): string {
  return `layout:v4:${workspaceRoot}`;
}

function normalizeSizes(partial: Partial<PersistedLayout>): PersistedLayout {
  let left = clampPanePercent(partial.leftSize ?? DEFAULT_LAYOUT.leftSize);
  let center = clampPanePercent(partial.centerSize ?? DEFAULT_LAYOUT.centerSize);
  let right = clampPanePercent(partial.rightSize ?? DEFAULT_LAYOUT.rightSize);
  const sum = left + center + right;
  if (sum > 0 && Math.abs(sum - 100) > 0.5) {
    left = clampPanePercent((left / sum) * 100);
    center = clampPanePercent((center / sum) * 100);
    right = clampPanePercent(100 - left - center);
  }
  return {
    leftSize: left,
    centerSize: center,
    rightSize: right,
    leftCollapsed: partial.leftCollapsed === true,
    rightCollapsed: partial.rightCollapsed === true,
    leftFilesSize: clampPercent(partial.leftFilesSize ?? DEFAULT_LAYOUT.leftFilesSize),
    bottomSize: clampPanelHeight(partial.bottomSize ?? DEFAULT_LAYOUT.bottomSize),
    bottomCollapsed: partial.bottomCollapsed !== false,
  };
}

export function readLayout(workspaceRoot: string): PersistedLayout {
  try {
    const raw =
      localStorage.getItem(layoutStorageKey(workspaceRoot)) ??
      localStorage.getItem(`layout:v3:${workspaceRoot}`) ??
      localStorage.getItem(`layout:v2:${workspaceRoot}`);
    if (!raw) {
      return { ...DEFAULT_LAYOUT };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedLayout> & {
      leftWidth?: number;
      rightWidth?: number;
    };
    // v4 percent layout
    if (
      typeof parsed.leftSize === "number" ||
      typeof parsed.centerSize === "number" ||
      typeof parsed.rightSize === "number"
    ) {
      return normalizeSizes(parsed);
    }
    // Legacy px layout — fall back to defaults (avoid bad ratios without container width)
    return {
      ...DEFAULT_LAYOUT,
      leftCollapsed: parsed.leftCollapsed === true,
      rightCollapsed: parsed.rightCollapsed === true,
      leftFilesSize: clampPercent(parsed.leftFilesSize ?? DEFAULT_LAYOUT.leftFilesSize),
      bottomCollapsed: parsed.bottomCollapsed !== false,
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function writeLayout(workspaceRoot: string, state: PersistedLayout): void {
  localStorage.setItem(layoutStorageKey(workspaceRoot), JSON.stringify(normalizeSizes(state)));
}

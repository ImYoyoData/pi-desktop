import * as prefs from "@renderer/utils/prefs";

export function clampPanelWidth(px: number, min = 180, max = 560): number {
  return Math.min(max, Math.max(min, px));
}

/** Clamp a horizontal pane size percentage (left / chat / right). */
export function clampPanePercent(value: number, min = 12, max = 70): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Bottom panel height as % of the chat column. */
export function clampPanelHeight(value: number, min = 18, max = 75): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** 最大化编辑器区之前的面板状态：退出最大化时还原。 */
export interface PreMaximizeState {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  bottomCollapsed: boolean;
  leftSize: number;
  centerSize: number;
  rightSize: number;
}

export interface PersistedLayout {
  leftSize: number;
  centerSize: number;
  rightSize: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  /** Height % of the bottom terminal panel within the chat column. */
  bottomSize: number;
  bottomCollapsed: boolean;
  /** 中央区域活动视图：聊天 / 智能体设置（整页）。 */
  centerView: CenterView;
  /** 智能体设置当前分类。 */
  customizeSection: string;
  /** 编辑器区最大化：右栏独占整个窗口。 */
  editorMaximized: boolean;
  /** 最大化前的面板状态。 */
  preMaximize: PreMaximizeState | null;
}

/** 中央区域视图：聊天 / Git / 拉取请求 / 智能体设置整页。 */
export type CenterView = "chat" | "git" | "pull-requests" | "customize";

function normalizeCenterView(value: unknown): CenterView {
  if (value === "customize" || value === "pull-requests" || value === "git") return value;
  return "chat";
}

export const DEFAULT_LAYOUT: PersistedLayout = {
  leftSize: 20,
  centerSize: 30,
  rightSize: 50,
  leftCollapsed: false,
  rightCollapsed: true,
  bottomSize: 30,
  bottomCollapsed: true,
  centerView: "chat",
  customizeSection: "appearance",
  editorMaximized: false,
  preMaximize: null,
};

function normalizePreMaximize(raw: unknown): PreMaximizeState | null {
	if (!raw || typeof raw !== "object") return null;
	const source = raw as Partial<PreMaximizeState>;
	if (typeof source.leftSize !== "number" || !Number.isFinite(source.leftSize)) {
		return null;
	}
	return {
		leftCollapsed: source.leftCollapsed === true,
		rightCollapsed: source.rightCollapsed === true,
		bottomCollapsed: source.bottomCollapsed === true,
		leftSize: clampPanePercent(source.leftSize),
		centerSize: clampPanePercent(source.centerSize ?? source.leftSize),
		rightSize: clampPanePercent(source.rightSize ?? source.leftSize),
	};
}

export const LAYOUT_SYNC_PREFIX = "layout:";

export function layoutStorageKey(workspaceRoot: string): string {
  return `layout:v4:${workspaceRoot}`;
}

/** 左栏宽度与折叠状态跨工作区共享，切换工作区时侧栏宽度保持不变。 */
const SHARED_LEFT_KEY = "layout:left:v1";

interface SharedLeftState {
  leftSize: number;
  leftCollapsed: boolean;
}

function readSharedLeft(): SharedLeftState | null {
  try {
    const raw = prefs.getItem(SHARED_LEFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SharedLeftState>;
    if (typeof parsed.leftSize !== "number" || !Number.isFinite(parsed.leftSize)) {
      return null;
    }
    return {
      leftSize: clampPanePercent(parsed.leftSize),
      leftCollapsed: parsed.leftCollapsed === true,
    };
  } catch {
    return null;
  }
}

function writeSharedLeft(state: SharedLeftState): void {
  prefs.setItem(
    SHARED_LEFT_KEY,
    JSON.stringify({
      leftSize: clampPanePercent(state.leftSize),
      leftCollapsed: state.leftCollapsed === true,
    }),
  );
}

/** 共享值缺失时，把本次读到的左栏状态记为初值，后续所有工作区读同一份。 */
function applySharedLeft(layout: PersistedLayout): PersistedLayout {
  const shared = readSharedLeft();
  if (!shared) {
    writeSharedLeft(layout);
    return layout;
  }
  return { ...layout, leftSize: shared.leftSize, leftCollapsed: shared.leftCollapsed };
}

function normalizeSizes(partial: Partial<PersistedLayout>): PersistedLayout {
  const left = clampPanePercent(partial.leftSize ?? DEFAULT_LAYOUT.leftSize);
  const rest = 100 - left;
  let center = clampPanePercent(partial.centerSize ?? DEFAULT_LAYOUT.centerSize);
  let right = clampPanePercent(partial.rightSize ?? DEFAULT_LAYOUT.rightSize);
  const pair = center + right;
  if (pair > 0 && Math.abs(pair - rest) > 0.5) {
    center = clampPanePercent((center / pair) * rest);
    right = clampPanePercent(rest - center);
  }
  return {
    leftSize: left,
    centerSize: center,
    rightSize: right,
    leftCollapsed: partial.leftCollapsed === true,
    rightCollapsed: partial.rightCollapsed === true,
    bottomSize: clampPanelHeight(partial.bottomSize ?? DEFAULT_LAYOUT.bottomSize),
    bottomCollapsed: partial.bottomCollapsed !== false,
    centerView: normalizeCenterView(partial.centerView),
    customizeSection:
      typeof partial.customizeSection === "string" && partial.customizeSection
        ? partial.customizeSection
        : DEFAULT_LAYOUT.customizeSection,
    editorMaximized: partial.editorMaximized === true,
    preMaximize: normalizePreMaximize(partial.preMaximize),
  };
}

export function readLayout(workspaceRoot: string): PersistedLayout {
  try {
    const raw =
      prefs.getItem(layoutStorageKey(workspaceRoot)) ??
      prefs.getItem(`layout:v3:${workspaceRoot}`) ??
      prefs.getItem(`layout:v2:${workspaceRoot}`);
    if (!raw) {
      return applySharedLeft({ ...DEFAULT_LAYOUT });
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
      return applySharedLeft(normalizeSizes(parsed));
    }
    // Legacy px layout — fall back to defaults (avoid bad ratios without container width)
    return applySharedLeft({
      ...DEFAULT_LAYOUT,
      leftCollapsed: parsed.leftCollapsed === true,
      rightCollapsed: parsed.rightCollapsed === true,
      bottomCollapsed: parsed.bottomCollapsed !== false,
      centerView: normalizeCenterView(parsed.centerView),
      customizeSection:
        typeof parsed.customizeSection === "string" && parsed.customizeSection
          ? parsed.customizeSection
          : DEFAULT_LAYOUT.customizeSection,
    });
  } catch {
    return applySharedLeft({ ...DEFAULT_LAYOUT });
  }
}

export function writeLayout(workspaceRoot: string, state: PersistedLayout): void {
  const normalized = normalizeSizes(state);
  writeSharedLeft(normalized);
  prefs.setItem(layoutStorageKey(workspaceRoot), JSON.stringify(normalized));
}

import { create } from "zustand";
import * as prefs from "@renderer/utils/prefs";

const DOCK_VIEW_KEY = "pi-desktop:right-dock-view:v1";

export const DOCK_PREF_KEYS = [DOCK_VIEW_KEY];

/** 右侧栏三个独立页面，同一时刻只显示一个。 */
export type RightDockView = "files" | "changes" | "browser";

const VIEWS: RightDockView[] = ["files", "changes", "browser"];

function isView(value: string | null): value is RightDockView {
  return value !== null && (VIEWS as string[]).includes(value);
}

type RightDockState = {
  view: RightDockView;
  /** 更改页当前选中的文件（消息里点文件路径时定位过来）。 */
  changesPath: string;
  show: (view: RightDockView) => void;
  showChanges: (path: string) => void;
  /** 另一窗口改了偏好后重新读取并应用。 */
  refreshFromPrefs: () => void;
};

function readPrefs(): RightDockView {
  try {
    const raw = prefs.getItem(DOCK_VIEW_KEY);
    if (isView(raw)) return raw;
  } catch {
    // ignore
  }
  return "changes";
}

function writePrefs(view: RightDockView): void {
  try {
    prefs.setItem(DOCK_VIEW_KEY, view);
  } catch {
    // ignore
  }
}

export const useRightDockStore = create<RightDockState>()((set, get) => ({
  view: readPrefs(),
  changesPath: "",

  show(view: RightDockView): void {
    writePrefs(view);
    set({ view });
  },

  showChanges(path: string): void {
    writePrefs("changes");
    set({ view: "changes", changesPath: path.replace(/\\/g, "/") });
  },

  refreshFromPrefs(): void {
    const view = readPrefs();
    if (view === get().view) return;
    set({ view });
  },
}));

import { create } from "zustand";
import * as prefs from "@renderer/utils/prefs";

const DOCK_VIEW_KEY = "pi-desktop:right-dock-view:v1";
const DOCK_DETAILS_KEY = "pi-desktop:right-dock-details:v1";

export const DOCK_PREF_KEYS = [DOCK_VIEW_KEY, DOCK_DETAILS_KEY];

export type RightDockView = "files" | "changes";

type RightDockState = {
  /** null 表示侧栏收起后下方这块也隐藏。 */
  view: RightDockView | null;
  lastView: RightDockView;
  show: (view: RightDockView) => void;
  toggle: () => void;
  /** 另一窗口改了偏好后重新读取并应用。 */
  refreshFromPrefs: () => void;
};

function readPrefs(): { view: RightDockView; visible: boolean } {
  let view: RightDockView = "changes";
  let visible = true;
  try {
    const raw = prefs.getItem(DOCK_VIEW_KEY);
    if (raw === "files" || raw === "changes") view = raw;
    if (prefs.getItem(DOCK_DETAILS_KEY) === "0") visible = false;
  } catch {
    // ignore
  }
  return { view, visible };
}

function writePrefs(view: RightDockView, visible: boolean): void {
  try {
    prefs.setItem(DOCK_VIEW_KEY, view);
    prefs.setItem(DOCK_DETAILS_KEY, visible ? "1" : "0");
  } catch {
    // ignore
  }
}

const initial = readPrefs();

export const useRightDockStore = create<RightDockState>()((set, get) => ({
  view: initial.visible ? initial.view : null,
  lastView: initial.view,

  show(view: RightDockView): void {
    writePrefs(view, true);
    set({ view, lastView: view });
  },

  toggle(): void {
    const { view, lastView } = get();
    const next = view ? null : lastView;
    writePrefs(view ?? lastView, next !== null);
    set({ view: next, lastView: view ?? lastView });
  },

  refreshFromPrefs(): void {
    const { view, visible } = readPrefs();
    const next = visible ? view : null;
    if (next === get().view && view === get().lastView) return;
    set({ view: next, lastView: view });
  },
}));

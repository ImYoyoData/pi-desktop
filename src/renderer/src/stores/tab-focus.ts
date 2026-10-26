import { create } from "zustand";
import * as prefs from "@renderer/utils/prefs";

export const TAB_FOCUS_KEY = "pi-desktop:tab-focus";

function readEnabled(): boolean {
  try {
    return prefs.getItem(TAB_FOCUS_KEY) !== "off";
  } catch {
    return true;
  }
}

type TabFocusState = {
  enabled: boolean;
  setEnabled: (next: boolean) => void;
};

/** 全局 Tab 键焦点切换；关闭后 Tab 不再在界面控件之间移动焦点。 */
export const useTabFocusStore = create<TabFocusState>()((set) => ({
  enabled: readEnabled(),
  setEnabled: (next) => {
    set({ enabled: next });
    try {
      prefs.setItem(TAB_FOCUS_KEY, next ? "on" : "off");
    } catch {
      // ignore
    }
  },
}));

import { create } from "zustand";
import * as prefs from "@renderer/utils/prefs";
import {
  REMEMBER_WINDOW_SIZE_PREF,
  WINDOW_SIZE_PREF,
} from "../../../shared/window-size";

function readEnabled(): boolean {
  try {
    return prefs.getItem(REMEMBER_WINDOW_SIZE_PREF) !== "off";
  } catch {
    return true;
  }
}

type WindowSizeState = {
  /** 记住窗口大小：下次启动按上次的大小开窗。 */
  rememberSize: boolean;
  setRememberSize: (next: boolean) => void;
  /** 另一端改了开关后重新读取。 */
  refreshFromPrefs: () => void;
};

export const useWindowSizeStore = create<WindowSizeState>()((set) => ({
  rememberSize: readEnabled(),
  setRememberSize: (next) => {
    set({ rememberSize: next });
    try {
      prefs.setItem(REMEMBER_WINDOW_SIZE_PREF, next ? "on" : "off");
      if (!next) prefs.removeItem(WINDOW_SIZE_PREF);
    } catch {
      // ignore
    }
  },
  refreshFromPrefs: () => set({ rememberSize: readEnabled() }),
}));

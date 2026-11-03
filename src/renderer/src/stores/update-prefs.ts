import { create } from "zustand";
import * as prefs from "@renderer/utils/prefs";
import {
  AUTO_UPDATE_CHECK_PREF,
  DEFAULT_UPDATE_CHECK_INTERVAL_HOURS,
  UPDATE_CHECK_INTERVAL_PREF,
  parseUpdateCheckIntervalHours,
} from "../../../shared/update";

function readAutoCheck(): boolean {
  try {
    return prefs.getItem(AUTO_UPDATE_CHECK_PREF) !== "off";
  } catch {
    return true;
  }
}

function readIntervalHours(): number {
  try {
    return parseUpdateCheckIntervalHours(
      prefs.getItem(UPDATE_CHECK_INTERVAL_PREF) ?? undefined,
    );
  } catch {
    return DEFAULT_UPDATE_CHECK_INTERVAL_HOURS;
  }
}

type UpdatePrefsState = {
  /** 启动后自动检查新版本。 */
  autoCheck: boolean;
  /** 自动检查的间隔（小时）。 */
  intervalHours: number;
  setAutoCheck: (next: boolean) => void;
  setIntervalHours: (next: number) => void;
  /** 另一端改了设置后重新读取。 */
  refreshFromPrefs: () => void;
};

export const useUpdatePrefsStore = create<UpdatePrefsState>()((set) => ({
  autoCheck: readAutoCheck(),
  intervalHours: readIntervalHours(),
  setAutoCheck: (next) => {
    set({ autoCheck: next });
    try {
      prefs.setItem(AUTO_UPDATE_CHECK_PREF, next ? "on" : "off");
    } catch {
      // ignore
    }
  },
  setIntervalHours: (next) => {
    const hours = parseUpdateCheckIntervalHours(String(next));
    set({ intervalHours: hours });
    try {
      prefs.setItem(UPDATE_CHECK_INTERVAL_PREF, String(hours));
    } catch {
      // ignore
    }
  },
  refreshFromPrefs: () => {
    set({ autoCheck: readAutoCheck(), intervalHours: readIntervalHours() });
  },
}));

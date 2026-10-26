import { create } from "zustand";
import * as prefs from "@renderer/utils/prefs";
import type { SessionTpsMode } from "@renderer/utils/session-stats";

export const TPS_MODE_KEY = "pi-desktop:tps-mode";

function readTpsMode(): SessionTpsMode {
  try {
    return prefs.getItem(TPS_MODE_KEY) === "end-to-end" ? "end-to-end" : "streaming";
  } catch {
    return "streaming";
  }
}

type SessionStatsState = {
  tpsMode: SessionTpsMode;
  setTpsMode: (next: SessionTpsMode) => void;
  /** 另一端改了口径后重新读取。 */
  refreshFromPrefs: () => void;
};

/** 统计条的 TPS 口径：只影响展示，worker 侧的计时不变。 */
export const useSessionStatsStore = create<SessionStatsState>()((set) => ({
  tpsMode: readTpsMode(),
  setTpsMode: (next) => {
    set({ tpsMode: next });
    try {
      prefs.setItem(TPS_MODE_KEY, next);
    } catch {
      // ignore
    }
  },
  refreshFromPrefs: () => set({ tpsMode: readTpsMode() }),
}));

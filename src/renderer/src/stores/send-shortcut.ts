import { create } from "zustand";
import * as prefs from "@renderer/utils/prefs";

export const SEND_SHORTCUT_KEY = "pi-desktop:send-shortcut";

/** enter、shift-enter、ctrl-enter：选中的组合发送，其余组合换行。 */
export type SendShortcutMode = "enter" | "shift-enter" | "ctrl-enter";

function readMode(): SendShortcutMode {
  try {
    const raw = prefs.getItem(SEND_SHORTCUT_KEY);
    return raw === "ctrl-enter" || raw === "shift-enter" ? raw : "enter";
  } catch {
    return "enter";
  }
}

type SendShortcutState = {
  mode: SendShortcutMode;
  setMode: (next: SendShortcutMode) => void;
  /** 另一端改了快捷键后重新读取。 */
  refreshFromPrefs: () => void;
};

export const useSendShortcutStore = create<SendShortcutState>()((set) => ({
  mode: readMode(),
  setMode: (next) => {
    set({ mode: next });
    try {
      prefs.setItem(SEND_SHORTCUT_KEY, next);
    } catch {
      // ignore
    }
  },
  refreshFromPrefs: () => set({ mode: readMode() }),
}));

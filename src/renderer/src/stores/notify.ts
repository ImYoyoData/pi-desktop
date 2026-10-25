import { create } from "zustand";
import chimeUrl from "@renderer/assets/sounds/qipao.mp3";
import * as prefs from "@renderer/utils/prefs";

export const PREFS_KEY = "pi-desktop:notify-prefs";

export type NotifyPrefs = {
  soundEnabled: boolean;
  notifyEnabled: boolean;
};

function readPrefs(): NotifyPrefs {
  try {
    const raw = prefs.getItem(PREFS_KEY);
    if (!raw) return { soundEnabled: true, notifyEnabled: true };
    const parsed = JSON.parse(raw) as Partial<NotifyPrefs>;
    return {
      soundEnabled: parsed.soundEnabled !== false,
      notifyEnabled: parsed.notifyEnabled !== false,
    };
  } catch {
    return { soundEnabled: true, notifyEnabled: true };
  }
}

let sharedAudio: HTMLAudioElement | null = null;

function getAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio(chimeUrl);
    sharedAudio.preload = "auto";
  }
  return sharedAudio;
}

type NotifyState = {
  soundEnabled: boolean;
  notifyEnabled: boolean;
  setSoundEnabled: (v: boolean) => void;
  setNotifyEnabled: (v: boolean) => void;
  /** 另一端改了通知设置后重新读取并应用。 */
  refreshFromPrefs: () => void;
  playChime: () => Promise<void>;
  onTurnComplete: (opts: {
    title: string;
    body: string;
    sessionId?: string;
  }) => Promise<void>;
};

export const useNotifyStore = create<NotifyState>()((set, get) => {
  function persistPrefs(): void {
    try {
      const { soundEnabled, notifyEnabled } = get();
      prefs.setItem(
        PREFS_KEY,
        JSON.stringify({
          soundEnabled,
          notifyEnabled,
        } satisfies NotifyPrefs),
      );
    } catch {
      // ignore quota / private mode
    }
  }

  async function playChime(): Promise<void> {
    try {
      const audio = getAudio();
      audio.currentTime = 0;
      await audio.play();
    } catch {
      // Autoplay / missing asset — ignore
    }
  }

  /** Called on prompt_done — respects prefs. */
  async function onTurnComplete(opts: {
    title: string;
    body: string;
    sessionId?: string;
  }): Promise<void> {
    if (get().soundEnabled) {
      void playChime();
    }
    if (get().notifyEnabled) {
      try {
        await window.api.notify.turnComplete(opts);
      } catch {
        // ignore
      }
    }
  }

  const initial = readPrefs();


  return {
    soundEnabled: initial.soundEnabled,
    notifyEnabled: initial.notifyEnabled,
    setSoundEnabled: (v) => {
      set({ soundEnabled: v });
      persistPrefs();
    },
    setNotifyEnabled: (v) => {
      set({ notifyEnabled: v });
      persistPrefs();
    },
    refreshFromPrefs: () => {
      const next = readPrefs();
      set({ soundEnabled: next.soundEnabled, notifyEnabled: next.notifyEnabled });
    },
    playChime,
    onTurnComplete,
  };
});

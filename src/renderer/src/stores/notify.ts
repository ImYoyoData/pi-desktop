import { defineStore } from "pinia";
import { ref, watch } from "vue";
import chimeUrl from "@renderer/assets/sounds/qipao.mp3";

const PREFS_KEY = "pi-desktop:notify-prefs";

export type NotifyPrefs = {
  soundEnabled: boolean;
  notifyEnabled: boolean;
};

function readPrefs(): NotifyPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
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

export const useNotifyStore = defineStore("notify", () => {
  const initial = readPrefs();
  const soundEnabled = ref(initial.soundEnabled);
  const notifyEnabled = ref(initial.notifyEnabled);

  watch([soundEnabled, notifyEnabled], () => {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          soundEnabled: soundEnabled.value,
          notifyEnabled: notifyEnabled.value,
        } satisfies NotifyPrefs),
      );
    } catch {
      // ignore quota / private mode
    }
  });

  function setSoundEnabled(v: boolean): void {
    soundEnabled.value = v;
  }

  function setNotifyEnabled(v: boolean): void {
    notifyEnabled.value = v;
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
  async function onTurnComplete(opts: { title: string; body: string }): Promise<void> {
    if (soundEnabled.value) {
      void playChime();
    }
    if (notifyEnabled.value) {
      try {
        await window.api.notify.turnComplete(opts);
      } catch {
        // ignore
      }
    }
  }

  return {
    soundEnabled,
    notifyEnabled,
    setSoundEnabled,
    setNotifyEnabled,
    playChime,
    onTurnComplete,
  };
});

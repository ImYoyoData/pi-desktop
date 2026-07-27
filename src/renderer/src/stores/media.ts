import { defineStore } from "pinia";

export type MediaRegisterOptions = {
  /** Reset currentTime when stopAll runs (default true). */
  resetOnStop?: boolean;
};

type MediaHandle = {
  id: string;
  el: HTMLMediaElement;
  resetOnStop: boolean;
};

/**
 * Global registry for <audio>/<video> in preview (and future) tabs.
 * Used to pause/stop playback when voice recording starts or UI hides a tab.
 */
export const useMediaStore = defineStore("media", () => {
  const handles = new Map<string, MediaHandle>();

  function register(
    id: string,
    el: HTMLMediaElement,
    opts?: MediaRegisterOptions,
  ): () => void {
    handles.set(id, {
      id,
      el,
      resetOnStop: opts?.resetOnStop !== false,
    });
    return () => {
      unregister(id);
    };
  }

  function unregister(id: string): void {
    handles.delete(id);
  }

  function stopElement(el: HTMLMediaElement, reset: boolean): void {
    try {
      el.pause();
    } catch {
      // ignore
    }
    if (!reset) return;
    try {
      el.currentTime = 0;
    } catch {
      // ignore seek errors on unloaded media
    }
  }

  /** Pause (+ optionally reset) every registered player. */
  function stopAll(opts?: { reset?: boolean }): void {
    const reset = opts?.reset !== false;
    for (const h of handles.values()) {
      stopElement(h.el, reset && h.resetOnStop);
    }
  }

  /** Pause only — keep playback position. */
  function pauseAll(): void {
    for (const h of handles.values()) {
      stopElement(h.el, false);
    }
  }

  /** Stop players whose id starts with the given prefix (e.g. one preview tab). */
  function stopByPrefix(prefix: string, opts?: { reset?: boolean }): void {
    const reset = opts?.reset !== false;
    for (const h of handles.values()) {
      if (!h.id.startsWith(prefix)) continue;
      stopElement(h.el, reset && h.resetOnStop);
    }
  }

  return {
    register,
    unregister,
    stopAll,
    pauseAll,
    stopByPrefix,
  };
});

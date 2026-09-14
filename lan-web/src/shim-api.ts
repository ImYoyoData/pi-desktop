/**
 * Minimal `window.api` stub so desktop Pinia stores / MessageList can mount in the browser.
 * Real session I/O goes through the LAN WebSocket, not these stubs.
 */

type AnyFn = (...args: unknown[]) => unknown;

function unsub(): () => void {
  return () => undefined;
}

function asyncNull(..._args: unknown[]): Promise<null> {
  return Promise.resolve(null);
}

function asyncEmptyArr(..._args: unknown[]): Promise<unknown[]> {
  return Promise.resolve([]);
}

/**
 * Browser-native text-to-speech for the web console.
 *
 * The desktop app speaks through a bundled Piper runtime downloaded over IPC;
 * a phone browser has no business doing that, so the web build uses the Web
 * Speech API instead. That keeps "朗读" working on the web with zero install and
 * nothing to download — the voices come from the OS/browser.
 *
 * The status shape mirrors the desktop one so the shared MessageList speak button
 * behaves identically: `enabled` + `installed` true, `speaking` live.
 */
type SpeakingListener = (payload: { speaking: boolean }) => void;

const speechSupported = (): boolean =>
  typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

let speakingNow = false;
const speakingListeners = new Set<SpeakingListener>();

function notifySpeaking(speaking: boolean): void {
  speakingNow = speaking;
  for (const listener of speakingListeners) {
    try {
      listener({ speaking });
    } catch {
      /* a broken listener must not break speech */
    }
  }
}

/** Prefer a voice matching the UI language, else the browser default. */
function pickVoice(): SpeechSynthesisVoice | null {
  if (!speechSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const wanted = document.documentElement.lang || navigator.language || "zh-CN";
  const exact = voices.find((v) => v.lang?.toLowerCase() === wanted.toLowerCase());
  if (exact) return exact;
  const base = wanted.split("-")[0]?.toLowerCase();
  return voices.find((v) => v.lang?.toLowerCase().startsWith(base ?? "")) ?? voices[0] ?? null;
}

function ttsStatus() {
  const supported = speechSupported();
  return {
    enabled: supported,
    supported,
    // No install step on the web: the browser supplies the voices.
    installed: supported,
    voicePath: null,
    binaryPath: null,
    voiceDiskMb: 0,
    runtimeDiskMb: 0,
    voiceLabel: supported ? "浏览器内置语音" : "",
    installing: false,
    speaking: speakingNow,
    runtimeArchiveHint: null,
    lastError: supported ? null : "当前浏览器不支持语音合成",
  };
}

/** Speak `text`, resolving once playback finishes (or fails). */
function speakText(text: string): Promise<{ ok: boolean; message?: string }> {
  return new Promise((resolve) => {
    if (!speechSupported()) {
      resolve({ ok: false, message: "浏览器不支持语音合成" });
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickVoice();
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang ?? document.documentElement.lang ?? "zh-CN";
      let settled = false;
      const done = (result: { ok: boolean; message?: string }): void => {
        if (settled) return;
        settled = true;
        notifySpeaking(false);
        resolve(result);
      };
      utterance.onend = () => done({ ok: true });
      utterance.onerror = (event) => done({ ok: false, message: event.error });
      notifySpeaking(true);
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      notifySpeaking(false);
      resolve({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  });
}

function stopSpeaking(): { ok: boolean } {
  try {
    if (speechSupported()) window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
  notifySpeaking(false);
  return { ok: true };
}

async function writeClipboardText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}

async function writeClipboardImage(dataUrl: string): Promise<void> {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    // ClipboardItem may be missing on some mobile browsers.
    const CI = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
    if (CI && navigator.clipboard && "write" in navigator.clipboard) {
      await navigator.clipboard.write([new CI({ [blob.type || "image/png"]: blob })]);
      return;
    }
  } catch {
    /* fall through */
  }
  await writeClipboardText(dataUrl);
}

export function installLanWindowApi(): void {
  const api = {
    clipboard: {
      writeText: writeClipboardText,
      writeImage: writeClipboardImage,
    },
    window: {
      platform: async () => "linux" as const,
      minimize: asyncNull,
      maximize: asyncNull,
      close: asyncNull,
      forceClose: asyncNull,
      isMaximized: async () => false,
      setThemeSource: asyncNull,
      setChromeTheme: asyncNull,
      setUiLocale: asyncNull,
      requestMediaAccess: async () => true,
      openDevTools: asyncNull,
      onCloseRequest: unsub,
      onMaximized: unsub,
    },
    sessions: {
      list: asyncEmptyArr,
      create: asyncNull,
      open: asyncNull,
      command: async () => ({}),
      tryCommand: async () => undefined,
      history: async () => ({ messages: [], hasMore: false }),
      fork: async () => {
        throw new Error("unavailable on LAN web");
      },
      killWorker: asyncNull,
      restartWorker: asyncNull,
      delete: asyncNull,
      rename: asyncNull,
      clearContext: asyncNull,
      onEvent: unsub,
    },
    checkpoint: {
      begin: async () => ({
        sessionId: "",
        userMessageId: "",
        status: "empty" as const,
        fileCount: 0,
        skippedCount: 0,
      }),
      finishActive: asyncNull,
      get: asyncNull,
      list: asyncEmptyArr,
      revert: async () => ({ ok: false, error: "unavailable on LAN web", restored: 0, deleted: 0 }),
      loadSummaries: asyncEmptyArr,
      onUpdated: unsub,
    },
    tts: {
      status: async () => ttsStatus(),
      setEnabled: async (enabled: unknown) => {
        if (enabled === false) stopSpeaking();
        return ttsStatus();
      },
      install: async () => ttsStatus(),
      uninstall: async () => ttsStatus(),
      speak: async (text: unknown) =>
        speakText(typeof text === "string" ? text : String(text ?? "")),
      stop: async () => stopSpeaking(),
      onProgress: unsub,
      onStatus: unsub,
      onSpeaking: (callback: (payload: { speaking: boolean }) => void) => {
        speakingListeners.add(callback);
        return () => {
          speakingListeners.delete(callback);
        };
      },
    },
    preview: {
      open: asyncNull,
      close: asyncNull,
    },
    workspace: {
      get: async () => null,
      listRecent: asyncEmptyArr,
      listClosed: asyncEmptyArr,
      open: asyncNull,
      openPath: asyncNull,
      onChanged: unsub,
    },
    asr: {
      status: async () => ({ enabled: false, busy: false }),
      onProgress: unsub,
      onStream: unsub,
    },
    notify: {
      on: unsub,
    },
    browser: {
      openExternal: async (url: unknown) => {
        if (typeof url === "string" && /^https?:\/\//i.test(url)) {
          window.open(url, "_blank", "noopener,noreferrer");
        }
      },
    },
  };

  // Catch-all for any deeper store probes.
  const proxy = new Proxy(api as Record<string, unknown>, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      const nested: Record<string, AnyFn> = {};
      return new Proxy(nested, {
        get(_t, key) {
          const name = String(key);
          if (name.startsWith("on")) return unsub;
          return asyncNull;
        },
      });
    },
  });

  (window as unknown as { api: typeof proxy }).api = proxy;
}

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
      status: async () => ({
        enabled: false,
        supported: false,
        installed: false,
        voicePath: null,
        binaryPath: null,
        voiceDiskMb: 0,
        runtimeDiskMb: 0,
        voiceLabel: "",
        installing: false,
        speaking: false,
        runtimeArchiveHint: null,
        lastError: null,
      }),
      setEnabled: asyncNull,
      install: asyncNull,
      speak: asyncNull,
      stop: asyncNull,
      onProgress: unsub,
      onStatus: unsub,
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

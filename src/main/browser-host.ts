import { webContents, ipcMain, BrowserWindow, shell } from "electron";
import type { ElementCitation } from "../shared/protocol";
import { IpcChannels } from "../shared/protocol";
import { truncateHtmlSnippet } from "../shared/html-snippet";
import {
  SELECT_ELEMENT_CONSOLE_PREFIX,
  injectSelectMode,
  readPendingSelection,
  removeSelectMode,
} from "./select-element-script";

/** Renderer listens for this to toggle the in-pane browser DevTools. */
export const IpcBrowserHotkeys = {
  toggleEmbeddedDevTools: IpcChannels.browser.toggleEmbeddedDevTools,
} as const;

type SelectState = {
  active: boolean;
  onConsoleMessage: (...args: unknown[]) => void;
};

const selectByWebContentsId = new Map<number, SelectState>();
const guestF12Bound = new Set<number>();

function broadcastElementSelected(citation: ElementCitation): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.browser.elementSelected, citation);
  }
}

function broadcastToggleEmbeddedDevTools(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.browser.toggleEmbeddedDevTools);
  }
}

function getGuest(webContentsId: number) {
  try {
    return webContents.fromId(webContentsId);
  } catch {
    return null;
  }
}

/** Prevent Chromium's default F12 (detach window) inside the page webview. */
function ensureGuestF12Intercept(page: Electron.WebContents): void {
  const id = page.id;
  if (guestF12Bound.has(id)) return;
  guestF12Bound.add(id);
  page.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F12") {
      event.preventDefault();
      broadcastToggleEmbeddedDevTools();
    }
  });
  page.once("destroyed", () => {
    guestF12Bound.delete(id);
  });
}

/** Electron 29+ uses (event, details); older / some guests use (event, level, message, ...). */
function extractConsoleMessage(...args: unknown[]): string | undefined {
  const details = args[1];
  if (details && typeof details === "object" && details !== null && "message" in details) {
    const msg = (details as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  if (typeof args[2] === "string") return args[2];
  for (const arg of args.slice(1)) {
    if (typeof arg === "string") return arg;
  }
  return undefined;
}

async function captureElementScreenshot(
  wc: Electron.WebContents,
  bounds: { x: number; y: number; width: number; height: number },
  viewport?: { vw?: number; vh?: number },
): Promise<string | undefined> {
  try {
    // Wait for outline removal + paint before capture (avoids wrong/blank crops)
    await wc.executeJavaScript(
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
      true,
    );
    await new Promise((r) => setTimeout(r, 48));

    const [viewW, viewH] = wc.getSize();
    const cssW = viewport?.vw && viewport.vw > 0 ? viewport.vw : viewW;
    const cssH = viewport?.vh && viewport.vh > 0 ? viewport.vh : viewH;

    let x = Math.max(0, Math.floor(bounds.x));
    let y = Math.max(0, Math.floor(bounds.y));
    let width = Math.max(1, Math.ceil(bounds.width));
    let height = Math.max(1, Math.ceil(bounds.height));
    if (cssW > 0 && cssH > 0) {
      x = Math.min(x, Math.max(0, cssW - 1));
      y = Math.min(y, Math.max(0, cssH - 1));
      width = Math.min(width, cssW - x);
      height = Math.min(height, cssH - y);
    }
    if (width < 1 || height < 1) return undefined;

    let image = await wc.capturePage({ x, y, width, height });

    // Fallback: full capture + crop (handles DPI / guest webview quirks)
    if (image.isEmpty()) {
      const full = await wc.capturePage();
      if (full.isEmpty()) return undefined;
      const fullSize = full.getSize();
      const scaleX = cssW > 0 ? fullSize.width / cssW : 1;
      const scaleY = cssH > 0 ? fullSize.height / cssH : 1;
      const crop = {
        x: Math.max(0, Math.round(x * scaleX)),
        y: Math.max(0, Math.round(y * scaleY)),
        width: Math.max(1, Math.round(width * scaleX)),
        height: Math.max(1, Math.round(height * scaleY)),
      };
      crop.width = Math.min(crop.width, fullSize.width - crop.x);
      crop.height = Math.min(crop.height, fullSize.height - crop.y);
      if (crop.width < 1 || crop.height < 1) return undefined;
      image = full.crop(crop);
      if (image.isEmpty()) return undefined;
    }

    // Shrink for IPC / composer preview reliability
    const size = image.getSize();
    const maxEdge = 640;
    if (size.width > maxEdge || size.height > maxEdge) {
      const scale = maxEdge / Math.max(size.width, size.height);
      image = image.resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
      });
    }
    return `data:image/png;base64,${image.toPNG().toString("base64")}`;
  } catch {
    return undefined;
  }
}

export function registerBrowserIpc(): void {
  ipcMain.handle(IpcChannels.browser.startSelect, async (_event, webContentsId: number) => {
    const wc = getGuest(webContentsId);
    if (!wc || wc.isDestroyed()) {
      return { ok: false as const, reason: "missing" as const };
    }

    const existing = selectByWebContentsId.get(webContentsId);
    if (existing) {
      wc.removeListener("console-message", existing.onConsoleMessage);
      selectByWebContentsId.delete(webContentsId);
    }

    const onConsoleMessage = (...args: unknown[]) => {
      void (async () => {
        try {
          const state = selectByWebContentsId.get(webContentsId);
          if (!state?.active) return;
          const message = extractConsoleMessage(...args);
          if (typeof message !== "string" || !message.startsWith(SELECT_ELEMENT_CONSOLE_PREFIX)) {
            return;
          }
          state.active = false;

          // Read selection from the page (avoids console truncation of large HTML)
          const payload = await readPendingSelection(wc);
          await removeSelectMode(wc);
          if (!payload) return;

          let screenshotDataUrl: string | undefined;
          if (payload.bounds && payload.bounds.width > 0 && payload.bounds.height > 0) {
            screenshotDataUrl = await captureElementScreenshot(wc, payload.bounds, {
              vw: payload.vw,
              vh: payload.vh,
            });
          }
          broadcastElementSelected({
            url: payload.url || wc.getURL(),
            selector: payload.selector,
            text: payload.text,
            htmlSnippet: truncateHtmlSnippet(payload.html ?? ""),
            screenshotDataUrl,
          });
        } catch {
          // Ignore malformed selection payloads / unexpected console shapes.
        }
      })();
    };

    try {
      await injectSelectMode(wc);
      wc.on("console-message", onConsoleMessage);
      selectByWebContentsId.set(webContentsId, { active: true, onConsoleMessage });
      return { ok: true as const };
    } catch {
      return { ok: false as const, reason: "csp" as const };
    }
  });

  ipcMain.handle(IpcChannels.browser.stopSelect, async (_event, webContentsId: number) => {
    const wc = getGuest(webContentsId);
    const state = selectByWebContentsId.get(webContentsId);
    if (state) {
      state.active = false;
      if (wc && !wc.isDestroyed()) {
        wc.removeListener("console-message", state.onConsoleMessage);
        await removeSelectMode(wc);
      }
      selectByWebContentsId.delete(webContentsId);
    }
  });

  /**
   * Embed DevTools into a dedicated webContents (second <webview>).
   * `open` is explicit — do not rely on isDevToolsOpened() which is unreliable with setDevToolsWebContents.
   */
  ipcMain.handle(
    IpcChannels.browser.attachDevTools,
    (
      _event,
      pageWebContentsId: number,
      devtoolsWebContentsId: number,
      open: boolean,
    ) => {
      const page = getGuest(pageWebContentsId);
      const dt = getGuest(devtoolsWebContentsId);
      if (!page || page.isDestroyed() || !dt || dt.isDestroyed()) return { ok: false as const };
      ensureGuestF12Intercept(page);

      if (!open) {
        try {
          if (page.isDevToolsOpened()) page.closeDevTools();
        } catch {
          // ignore
        }
        return { ok: true as const, open: false as const };
      }

      try {
        // Host DevTools in a guest <webview>. Electron often opens a stub
        // connection (empty Network / Elements) until the DevTools document reloads.
        // See https://github.com/electron/electron/issues/17168
        page.setDevToolsWebContents(dt);
        page.openDevTools({ mode: "detach" });

        let rebound = false;
        const rebindFrontend = (): void => {
          if (rebound || dt.isDestroyed()) return;
          rebound = true;
          void dt.executeJavaScript("window.location.reload()").catch(() => {
            try {
              if (!dt.isDestroyed()) dt.reload();
            } catch {
              // ignore
            }
          });
        };

        dt.once("did-finish-load", () => {
          // First DevTools frontend paint — reload once to fix stub agent link
          setTimeout(rebindFrontend, 50);
        });
        // Fallback if did-finish-load already fired / never fires
        setTimeout(rebindFrontend, 400);

        return { ok: true as const, open: true as const };
      } catch {
        return { ok: false as const };
      }
    },
  );

  ipcMain.handle(IpcChannels.browser.registerGuest, (_event, pageWebContentsId: number) => {
    const page = getGuest(pageWebContentsId);
    if (!page || page.isDestroyed()) return { ok: false as const };
    ensureGuestF12Intercept(page);
    return { ok: true as const };
  });

  ipcMain.handle(IpcChannels.browser.openDevTools, (_event, webContentsId: number) => {
    // Intentionally no-op for detach windows — use attachDevTools for embedded pane only.
    void webContentsId;
  });

  ipcMain.handle(IpcChannels.browser.openExternal, async (_event, url: string) => {
    const trimmed = url?.trim();
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) return;
    await shell.openExternal(trimmed);
  });
}

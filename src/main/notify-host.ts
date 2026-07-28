import { app, BrowserWindow, Notification, ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import { getUiLocale } from "./ui-locale";

/** Keep Notification instances alive until click/close — otherwise GC drops the click handler. */
const liveNotifications = new Set<Notification>();

function defaultTurnCompleteBody(): string {
  return getUiLocale() === "zh-CN" ? "回答已完成" : "Turn complete";
}

function isMainWindowFocused(): boolean {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length === 0) return false;
  // Prefer any focused app window; otherwise treat as background.
  return wins.some((w) => !w.isDestroyed() && w.isFocused());
}

function resolveMainWindow(): BrowserWindow | null {
  const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  if (!wins.length) return null;
  return BrowserWindow.getFocusedWindow() ?? wins[0] ?? null;
}

/** Bring the app window to the foreground (notification click / tray-style restore). */
export function focusMainWindow(): void {
  const win = resolveMainWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (process.platform === "darwin") {
    try {
      app.focus({ steal: true });
    } catch {
      // Older Electron / rare focus failures — show+focus above is enough.
    }
  }
}

function trackNotification(n: Notification): void {
  liveNotifications.add(n);
  const release = (): void => {
    liveNotifications.delete(n);
  };
  n.once("close", release);
  n.once("failed", release);
}

export function registerNotifyIpc(): void {
  ipcMain.handle(
    IpcChannels.notify.turnComplete,
    (_event, payload: { title?: string; body?: string }) => {
      const focused = isMainWindowFocused();
      if (focused) {
        return { ok: true as const, notified: false, focused: true };
      }
      if (!Notification.isSupported()) {
        return { ok: false as const, notified: false, focused: false, error: "unsupported" };
      }
      const title = (payload?.title || "Pi Desktop").trim() || "Pi Desktop";
      const body = (payload?.body || "").trim() || defaultTurnCompleteBody();
      try {
        const n = new Notification({ title, body, silent: true });
        // Bind before show() so platforms that deliver click early still focus the app.
        n.on("click", () => {
          focusMainWindow();
          liveNotifications.delete(n);
        });
        trackNotification(n);
        n.show();
        return { ok: true as const, notified: true, focused: false };
      } catch (err) {
        return {
          ok: false as const,
          notified: false,
          focused: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
}

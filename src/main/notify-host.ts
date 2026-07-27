import { BrowserWindow, Notification, ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";

function isMainWindowFocused(): boolean {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length === 0) return false;
  // Prefer any focused app window; otherwise treat as background.
  return wins.some((w) => !w.isDestroyed() && w.isFocused());
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
      const body = (payload?.body || "").trim() || "Turn complete";
      try {
        const n = new Notification({ title, body, silent: true });
        n.show();
        n.on("click", () => {
          const win = BrowserWindow.getAllWindows()[0];
          if (!win || win.isDestroyed()) return;
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        });
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

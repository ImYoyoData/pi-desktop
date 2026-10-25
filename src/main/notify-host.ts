import { app, BrowserWindow, Notification, ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import { getUiLocale } from "./ui-locale";
import type { EditMenuLocale } from "../shared/edit-menu-i18n";
import type { SessionBroker } from "./session-broker";

/** Keep Notification instances alive until click/close — otherwise GC drops the click handler. */
const liveNotifications = new Set<Notification>();

const TURN_COMPLETE_BODY: Record<EditMenuLocale, string> = {
  "zh-CN": "回答已完成",
  "zh-TW": "回答已完成",
  ja: "応答が完了しました",
  en: "Turn complete",
};

function defaultTurnCompleteBody(): string {
  return TURN_COMPLETE_BODY[getUiLocale()];
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
export function focusMainWindow(): BrowserWindow | null {
  const win = resolveMainWindow();
  if (!win) return null;
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
  return win;
}

function trackNotification(n: Notification): void {
  liveNotifications.add(n);
  const release = (): void => {
    liveNotifications.delete(n);
  };
  n.once("close", release);
  n.once("failed", release);
}

export function registerNotifyIpc(broker: Pick<SessionBroker, "cwdOfSession">): void {
  ipcMain.handle(
    IpcChannels.notify.turnComplete,
    (_event, payload: { title?: string; body?: string; sessionId?: string }) => {
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
          const win = focusMainWindow();
          liveNotifications.delete(n);
          const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId : "";
          if (win && sessionId) {
            // 一并带上 cwd：渲染进程可能没加载过该会话所在工作区的列表，仅靠 sessionId 无法定位。
            const cwd = broker.cwdOfSession(sessionId) ?? undefined;
            win.webContents.send(IpcChannels.notify.openSession, { sessionId, cwd });
          }
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

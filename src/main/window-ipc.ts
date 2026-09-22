import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";
import { BrowserWindow, clipboard, ipcMain, nativeTheme, systemPreferences } from "electron";
import { ClipboardItem, nativeImage } from "electron";
import { IpcChannels } from "../shared/protocol";
import type { WindowPrivilegeLevel, WindowRunIdentity } from "../shared/protocol";
import type { EditContextMenuAction } from "../shared/context-menu";
import type { EditMenuLocale } from "../shared/edit-menu-i18n";
import { allowWindowClose, setUiLocale } from "./window";

const EDIT_COMMANDS: Record<EditContextMenuAction, (wc: Electron.WebContents) => void> = {
  undo: (wc) => wc.undo(),
  redo: (wc) => wc.redo(),
  cut: (wc) => wc.cut(),
  copy: (wc) => wc.copy(),
  paste: (wc) => wc.paste(),
  delete: (wc) => wc.delete(),
  selectAll: (wc) => wc.selectAll(),
};

type ThemeSource = "system" | "light" | "dark";
type ChromeTheme = "light" | "dark";

function applyChrome(win: BrowserWindow, mode: ChromeTheme): void {
  const bg = mode === "dark" ? "#18181b" : "#f4f4f5";
  try {
    win.setBackgroundColor(bg);
  } catch {
    // ignore
  }
  // Do NOT enable titleBarOverlay on Windows: it owns the title-bar hit-test
  // strip and blocks `-webkit-app-region: drag` on our custom TitleBar.
  // Window chrome buttons are drawn in the renderer instead.
}

let cachedIdentity: WindowRunIdentity | undefined;

/** 运行身份：Windows 先认 SYSTEM 账户，再用 fltmc 判断是否已提升；类 Unix 以 uid 0 视为管理员。 */
function runIdentity(): WindowRunIdentity {
  if (cachedIdentity) return cachedIdentity;
  const username = userInfo().username;
  let level: WindowPrivilegeLevel;
  if (process.platform !== "win32") {
    level = process.getuid?.() === 0 ? "admin" : "user";
  } else if (username.toLowerCase() === "system") {
    level = "system";
  } else {
    const probe = spawnSync("fltmc", [], { stdio: "ignore", windowsHide: true });
    level = probe.status === 0 ? "admin" : "user";
  }
  cachedIdentity = { username, level };
  return cachedIdentity;
}

export function registerWindowIpc(): void {
  ipcMain.handle(IpcChannels.window.platform, () => process.platform);

  ipcMain.handle(IpcChannels.window.identity, () => runIdentity());

  ipcMain.handle(IpcChannels.window.minimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle(IpcChannels.window.maximize, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.handle(IpcChannels.window.close, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle(IpcChannels.window.forceClose, (event) => {
    allowWindowClose();
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle(IpcChannels.window.isMaximized, (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  ipcMain.handle(IpcChannels.window.setThemeSource, (_event, source: ThemeSource) => {
    if (source === "system" || source === "light" || source === "dark") {
      nativeTheme.themeSource = source;
    }
  });

  ipcMain.handle(IpcChannels.window.setChromeTheme, (event, mode: ChromeTheme) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (mode === "light" || mode === "dark") applyChrome(win, mode);
  });

  ipcMain.handle(IpcChannels.window.setUiLocale, (_event, next: EditMenuLocale) => {
    if (next === "zh-CN" || next === "en") setUiLocale(next);
  });

  /** macOS requires TCC prompt via askForMediaAccess before getUserMedia works reliably. */
  ipcMain.handle(IpcChannels.window.requestMediaAccess, async (_event, kind: "microphone" | "camera") => {
    if (kind !== "microphone" && kind !== "camera") return false;
    if (process.platform !== "darwin") return true;
    try {
      const status = systemPreferences.getMediaAccessStatus(kind);
      if (status === "granted") return true;
      // Already denied in System Settings — askForMediaAccess will not show a dialog.
      if (status === "denied" || status === "restricted") return false;
      return await systemPreferences.askForMediaAccess(kind);
    } catch {
      return false;
    }
  });

  /** Copy a data-URL image to the system clipboard (real image, pasteable anywhere). */
  ipcMain.handle(IpcChannels.clipboard.writeImage, async (_event, dataUrl: string) => {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
      throw new Error("clipboard.writeImage: expected an image data URL");
    }
    const image = nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) throw new Error("clipboard.writeImage: failed to decode image");
    await clipboard.write([
      new ClipboardItem({ "image/png": new Blob([new Uint8Array(image.toPNG())], { type: "image/png" }) }),
    ]);
  });
  /** Open (or focus) the app Chromium DevTools for this window. */
  ipcMain.handle(IpcChannels.window.openDevTools, (event) => {
    const wc = event.sender;
    if (wc.isDevToolsOpened()) {
      wc.devToolsWebContents?.focus();
      return;
    }
    wc.openDevTools({ mode: "detach" });
  });

  ipcMain.handle(IpcChannels.window.contextMenuAction, (event, action: EditContextMenuAction) => {
    const run = EDIT_COMMANDS[action];
    if (!run || event.sender.isDestroyed()) return;
    run(event.sender);
  });
}

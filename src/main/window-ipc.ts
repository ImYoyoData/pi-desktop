import { BrowserWindow, ipcMain, nativeTheme } from "electron";
import { IpcChannels } from "../shared/protocol";

type ThemeSource = "system" | "light" | "dark";
type ChromeTheme = "light" | "dark";

function applyChrome(win: BrowserWindow, mode: ChromeTheme): void {
  const bg = mode === "dark" ? "#18181b" : "#f4f4f5";
  const symbol = mode === "dark" ? "#a1a1aa" : "#71717a";
  try {
    win.setBackgroundColor(bg);
  } catch {
    // ignore
  }
  if (process.platform === "win32") {
    try {
      win.setTitleBarOverlay({
        color: bg,
        symbolColor: symbol,
        height: 36,
      });
    } catch {
      // ignore when overlay unavailable
    }
  }
}

export function registerWindowIpc(): void {
  ipcMain.handle(IpcChannels.window.platform, () => process.platform);

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
}

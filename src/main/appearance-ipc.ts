/** 自定义外观 IPC：选择壁纸与本地字体文件。 */

import { BrowserWindow, dialog, ipcMain, type FileFilter } from "electron";
import {
  FONT_FILE_EXTENSIONS,
  WALLPAPER_IMAGE_EXTENSIONS,
  WALLPAPER_VIDEO_EXTENSIONS,
} from "../shared/appearance";
import { IpcChannels } from "../shared/protocol";

async function pickFile(filters: FileFilter[]): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const options = { properties: ["openFile" as const], filters };
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0] ?? null;
}

function pickWallpaper(): Promise<string | null> {
  return pickFile([
    { name: "Images", extensions: [...WALLPAPER_IMAGE_EXTENSIONS] },
    { name: "Videos", extensions: [...WALLPAPER_VIDEO_EXTENSIONS] },
  ]);
}

function pickFontFile(): Promise<string | null> {
  return pickFile([{ name: "Fonts", extensions: [...FONT_FILE_EXTENSIONS] }]);
}

export function registerAppearanceIpc(): void {
  ipcMain.handle(IpcChannels.appearance.pickWallpaper, () => pickWallpaper());
  ipcMain.handle(IpcChannels.appearance.pickFontFile, () => pickFontFile());
}

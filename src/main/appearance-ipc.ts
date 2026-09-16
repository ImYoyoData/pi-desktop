/** 自定义外观 IPC：选择壁纸文件。 */

import { BrowserWindow, dialog, ipcMain } from "electron";
import {
  WALLPAPER_IMAGE_EXTENSIONS,
  WALLPAPER_VIDEO_EXTENSIONS,
} from "../shared/appearance";
import { IpcChannels } from "../shared/protocol";

async function pickWallpaper(): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const options = {
    properties: ["openFile" as const],
    filters: [
      { name: "Images", extensions: [...WALLPAPER_IMAGE_EXTENSIONS] },
      { name: "Videos", extensions: [...WALLPAPER_VIDEO_EXTENSIONS] },
    ],
  };
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0] ?? null;
}

export function registerAppearanceIpc(): void {
  ipcMain.handle(IpcChannels.appearance.pickWallpaper, () => pickWallpaper());
}

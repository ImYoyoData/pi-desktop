/**
 * 「运行」设置 IPC：落盘 settings.json 后热重载 worker 的 SDK 设置并广播所有窗口。
 * 压缩 / 缓存保温 / 隐私统计都由 pi 读 settings.json，worker reload 即生效。
 */

import { BrowserWindow, ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import type { RuntimeSettings } from "../shared/runtime-settings";
import { getRuntimeSettings, setRuntimeSettings } from "./runtime-settings-host";
import type { SessionBroker } from "./session-broker";

function broadcastRuntimeSettings(settings: RuntimeSettings): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.runtime.changed, settings);
  }
}

export function registerRuntimeSettingsIpc(broker?: SessionBroker): void {
  ipcMain.handle(IpcChannels.runtime.get, () => getRuntimeSettings());

  ipcMain.handle(IpcChannels.runtime.set, async (_event, next: unknown) => {
    const saved = await setRuntimeSettings(next);
    broadcastRuntimeSettings(saved);
    await broker?.notifyWorkersReloadResources();
    return saved;
  });
}

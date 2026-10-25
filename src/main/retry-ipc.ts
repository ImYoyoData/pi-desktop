/**
 * 「重试」设置 IPC：落盘后更新主进程卡死阈值、热重载 worker 的 SDK 设置并广播所有窗口。
 * turn 层 / provider 层的参数由 pi SDK 直接读 settings.json 的 retry 段，worker reload 即生效。
 */

import { ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import type { RetrySettings } from "../shared/retry-settings";
import { getRetrySettings, setRetrySettings } from "./retry-host";
import { setStallEmitMs } from "./session-broker";
import type { SessionBroker } from "./session-broker";
import { broadcastStateChange } from "./ui-sync";

/** 主进程内生效的部分：卡死判定阈值。 */
export function applyRetrySettings(settings: RetrySettings): void {
  setStallEmitMs(settings.desktop.stallSilenceMs);
}

/** 启动时把盘上的设置应用到主进程（窗口未建，无需广播）。 */
export function initRetrySettings(): void {
  applyRetrySettings(getRetrySettings());
}

function broadcastRetrySettings(settings: RetrySettings): void {
  broadcastStateChange({ scope: "retry", payload: settings });
}

export function registerRetryIpc(broker?: SessionBroker): void {
  ipcMain.handle(IpcChannels.retry.get, () => getRetrySettings());

  ipcMain.handle(IpcChannels.retry.set, async (_event, next: unknown) => {
    const saved = await setRetrySettings(next);
    applyRetrySettings(saved);
    broadcastRetrySettings(saved);
    await broker?.notifyWorkersReloadResources();
    return saved;
  });
}

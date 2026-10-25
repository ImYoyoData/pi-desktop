import { BrowserWindow } from "electron";
import { IpcChannels } from "../shared/protocol";
import type { StateChange } from "../shared/state-sync";
import { isUpdateToastWindow } from "./update-toast";

/**
 * 广播共享状态变化。
 * 桌面端所有窗口与浏览器预览页都会收到同一条事件，两侧界面因此保持一致。
 */
export function broadcastStateChange(change: StateChange): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (win.isDestroyed()) continue;
		if (isUpdateToastWindow(win)) continue;
		win.webContents.send(IpcChannels.state.changed, change);
	}
}

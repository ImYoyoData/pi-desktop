/** 桌面端偏好 IPC：整份读取（渲染层启动同步用）、按键写入与删除。 */

import { ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import { prefsPath, readPrefs, removePrefs, updatePrefs } from "./prefs-store";

export function registerPrefsIpc(): void {
	ipcMain.on(IpcChannels.prefs.readSync, (event) => {
		event.returnValue = readPrefs(prefsPath());
	});

	ipcMain.on(IpcChannels.prefs.setSync, (_event, patch: Record<string, string>) => {
		if (patch && Object.keys(patch).length) void updatePrefs(patch);
	});

	ipcMain.on(IpcChannels.prefs.removeSync, (_event, keys: string[]) => {
		if (Array.isArray(keys) && keys.length) void removePrefs(keys);
	});

	ipcMain.handle(IpcChannels.prefs.get, () => readPrefs(prefsPath()));

	ipcMain.handle(
		IpcChannels.prefs.set,
		(_event, patch: Record<string, string>) => updatePrefs(patch ?? {}),
	);

	ipcMain.handle(
		IpcChannels.prefs.remove,
		(_event, keys: string[]) => removePrefs(Array.isArray(keys) ? keys : []),
	);
}
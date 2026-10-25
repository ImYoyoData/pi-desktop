/** 桌面端偏好 IPC：整份读取（渲染层启动同步用）、按键写入与删除。 */

import { ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import { prefsPath, readPrefs, removePrefs, updatePrefs } from "./prefs-store";
import { broadcastStateChange } from "./ui-sync";

function broadcastPrefs(patch: Record<string, string>, removed: string[]): void {
	broadcastStateChange({
		scope: "prefs",
		keys: [...Object.keys(patch), ...removed],
		payload: { patch, removed },
	});
}

export function registerPrefsIpc(): void {
	ipcMain.on(IpcChannels.prefs.readSync, (event) => {
		event.returnValue = readPrefs(prefsPath());
	});

	ipcMain.on(IpcChannels.prefs.setSync, (_event, patch: Record<string, string>) => {
		if (patch && Object.keys(patch).length) {
			void updatePrefs(patch).then(() => {
				broadcastPrefs(patch, []);
			});
		}
	});

	ipcMain.on(IpcChannels.prefs.removeSync, (_event, keys: string[]) => {
		if (Array.isArray(keys) && keys.length) {
			void removePrefs(keys).then(() => {
				broadcastPrefs({}, keys);
			});
		}
	});

	ipcMain.handle(IpcChannels.prefs.get, () => readPrefs(prefsPath()));

	ipcMain.handle(
		IpcChannels.prefs.set,
		async (_event, patch: Record<string, string>) => {
			const safe = patch ?? {};
			const merged = await updatePrefs(safe);
			broadcastPrefs(safe, []);
			return merged;
		},
	);

	ipcMain.handle(
		IpcChannels.prefs.remove,
		async (_event, keys: string[]) => {
			const safe = Array.isArray(keys) ? keys : [];
			const rest = await removePrefs(safe);
			broadcastPrefs({}, safe);
			return rest;
		},
	);
}

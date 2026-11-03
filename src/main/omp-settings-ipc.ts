import { BrowserWindow, ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import { readOmpSettings, saveOmpSettings } from "./omp-settings-host";
import type { SessionBroker } from "./session-broker";
import { createWorkerRestartScheduler } from "./worker-restart-scheduler";

export function registerOmpSettingsIpc(broker: SessionBroker): void {
	// omp 的 Settings 在 worker 启动时读入，改完配置要让存活 worker 重读。
	const restartWorkers = createWorkerRestartScheduler(() =>
		broker.restartWorkersForBackend("omp"),
	);

	ipcMain.handle(IpcChannels.ompSettings.get, () => readOmpSettings());

	ipcMain.handle(
		IpcChannels.ompSettings.save,
		(_event, patch: Record<string, unknown>) => {
			const snapshot = saveOmpSettings(
				patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {},
			);
			restartWorkers();
			for (const window of BrowserWindow.getAllWindows()) {
				window.webContents.send(IpcChannels.ompSettings.changed);
			}
			return snapshot;
		},
	);
}

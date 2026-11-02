import { ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import { readOmpSettings, saveOmpSettings } from "./omp-settings-host";
import type { SessionBroker } from "./session-broker";

/** 连续保存时的重启合并窗口：自动保存会成串写入，别每次都重建 worker。 */
const WORKER_RESTART_DELAY_MS = 1500;

export function registerOmpSettingsIpc(broker: SessionBroker): void {
	let restartTimer: ReturnType<typeof setTimeout> | null = null;

	function scheduleWorkerRestart(): void {
		if (restartTimer) clearTimeout(restartTimer);
		restartTimer = setTimeout(() => {
			restartTimer = null;
			// omp 的 Settings 在 worker 启动时读入，改完配置要重建存活 worker。
			void broker.restartWorkersForBackend("omp");
		}, WORKER_RESTART_DELAY_MS);
	}

	ipcMain.handle(IpcChannels.ompSettings.get, () => readOmpSettings());

	ipcMain.handle(
		IpcChannels.ompSettings.save,
		(_event, patch: Record<string, unknown>) => {
			const snapshot = saveOmpSettings(
				patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {},
			);
			scheduleWorkerRestart();
			return snapshot;
		},
	);
}

import { ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import { readOmpSettings, saveOmpSettings } from "./omp-settings-host";
import type { SessionBroker } from "./session-broker";

export function registerOmpSettingsIpc(broker: SessionBroker): void {
	ipcMain.handle(IpcChannels.ompSettings.get, () => readOmpSettings());

	ipcMain.handle(
		IpcChannels.ompSettings.save,
		(_event, patch: Record<string, unknown>) => {
			const snapshot = saveOmpSettings(
				patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {},
			);
			// omp 的 Settings 在 worker 启动时读入，改完配置要重建存活 worker。
			void broker.restartWorkersForBackend("omp");
			return snapshot;
		},
	);
}

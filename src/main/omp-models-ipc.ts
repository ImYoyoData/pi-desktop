import { ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import type { OmpProviderRow } from "../shared/omp-models";
import { readOmpModels, saveOmpModels } from "./omp-models-config";
import type { SessionBroker } from "./session-broker";

export function registerOmpModelsIpc(broker: SessionBroker): void {
	ipcMain.handle(IpcChannels.ompModels.get, () => readOmpModels());

	ipcMain.handle(
		IpcChannels.ompModels.save,
		(_event, providers: OmpProviderRow[]) => {
			const snapshot = saveOmpModels(Array.isArray(providers) ? providers : []);
			// 存活的 omp worker 立刻按新 models.yml 重建模型表。
			void broker.notifyWorkersReloadModels("omp");
			return snapshot;
		},
	);
}

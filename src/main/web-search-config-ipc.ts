import { ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import {
	getWebSearchConfig,
	setWebSearchSettings,
} from "./web-search-config-host";

export function registerWebSearchConfigIpc(): void {
	ipcMain.handle(IpcChannels.webSearchConfig.get, () => getWebSearchConfig());

	ipcMain.handle(IpcChannels.webSearchConfig.set, (_event, next: unknown) =>
		setWebSearchSettings(next),
	);
}
import { ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import {
	applyTempCleanupSettings,
	getTempCleanupSettings,
	sweepTempOutputs,
} from "./temp-cleanup-host";

export function registerTempCleanupIpc(): void {
	ipcMain.handle(IpcChannels.tempCleanup.get, () => getTempCleanupSettings());

	ipcMain.handle(IpcChannels.tempCleanup.set, (_event, next: unknown) =>
		applyTempCleanupSettings(next),
	);

	ipcMain.handle(IpcChannels.tempCleanup.sweep, () => {
		const settings = getTempCleanupSettings();
		return sweepTempOutputs(settings.maxAgeHours);
	});
}

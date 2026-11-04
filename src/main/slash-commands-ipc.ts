import { ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import { readSlashCatalog } from "./slash-commands-host";

export function registerSlashCommandsIpc(): void {
	ipcMain.handle(IpcChannels.slashCommands.list, (_event, root: unknown) =>
		readSlashCatalog(typeof root === "string" && root.trim() ? root : null),
	);
}

import { ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import { emptyCustomizations, type CustomizationCreateKind } from "../shared/customizations";
import { getWorkspace } from "./workspace-ipc";
import { createCustomization, listCustomizations } from "./customizations-host";

export function registerCustomizationsIpc(): void {
	ipcMain.handle(IpcChannels.customizations.list, async (_event, cwd?: string) => {
		const root = cwd || getWorkspace();
		if (!root) return emptyCustomizations(null);
		return listCustomizations(root);
	});

	ipcMain.handle(IpcChannels.customizations.create, (_event, kind: CustomizationCreateKind) =>
		createCustomization(kind),
	);
}

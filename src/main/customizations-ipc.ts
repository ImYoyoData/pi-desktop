import { ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import { emptyCustomizations, type CustomizationCreateKind, type McpTestResult, type McpTestTarget } from "../shared/customizations";
import { getWorkspace } from "./workspace-ipc";
import { createCustomization, listCustomizations, setMcpServerEnabled, addMcpServers, ensureMcpConfig, removeMcpServer, readMcpEntry, setCustomizationItemEnabled, removeCustomizationItem } from "./customizations-host";
import { testMcpServer } from "./mcp-test";

export function registerCustomizationsIpc(broker?: {
	notifyWorkersReloadResources: (cwd: string) => Promise<void>;
}): void {
	ipcMain.handle(IpcChannels.customizations.list, async (_event, cwd?: string) => {
		const root = cwd || getWorkspace();
		if (!root) return emptyCustomizations(null);
		return listCustomizations(root);
	});

	ipcMain.handle(IpcChannels.customizations.create, (_event, kind: CustomizationCreateKind) =>
		createCustomization(kind),
	);

	ipcMain.handle(
		IpcChannels.customizations.setMcpEnabled,
		async (_event, name: string, scope: "user" | "project", enabled: boolean, cwd?: string) => {
			const root = cwd || getWorkspace();
			if (scope === "project" && !root) throw new Error("workspace required");
			setMcpServerEnabled(name, scope, enabled, root ?? undefined);
			if (root) await broker?.notifyWorkersReloadResources(root);
		},
	);

	ipcMain.handle(
		IpcChannels.customizations.addMcpServers,
		async (_event, scope: "user" | "project", servers: Record<string, unknown>, cwd?: string) => {
			const root = cwd || getWorkspace();
			if (scope === "project" && !root) throw new Error("workspace required");
			const result = addMcpServers(scope, servers, root ?? undefined);
			if (root) await broker?.notifyWorkersReloadResources(root);
			return result;
		},
	);

	ipcMain.handle(
		IpcChannels.customizations.ensureMcpConfig,
		(_event, scope: "user" | "project", cwd?: string) => {
			const root = cwd || getWorkspace();
			if (scope === "project" && !root) throw new Error("workspace required");
			return ensureMcpConfig(scope, root ?? undefined);
		},
	);

	ipcMain.handle(
		IpcChannels.customizations.removeMcpServer,
		async (_event, name: string, scope: "user" | "project", cwd?: string) => {
			const root = cwd || getWorkspace();
			if (scope === "project" && !root) throw new Error("workspace required");
			const result = removeMcpServer(name, scope, root ?? undefined);
			if (root) await broker?.notifyWorkersReloadResources(root);
			return result;
		},
	);

	ipcMain.handle(
		IpcChannels.customizations.setItemEnabled,
		async (_event, filePath: string, enabled: boolean, cwd?: string) => {
			const root = cwd || getWorkspace() || undefined;
			const result = setCustomizationItemEnabled(filePath, enabled, root);
			if (root) await broker?.notifyWorkersReloadResources(root);
			return result;
		},
	);

	ipcMain.handle(
		IpcChannels.customizations.removeItem,
		async (_event, filePath: string, cwd?: string) => {
			const root = cwd || getWorkspace() || undefined;
			const result = removeCustomizationItem(filePath, root);
			if (root) await broker?.notifyWorkersReloadResources(root);
			return result;
		},
	);

	ipcMain.handle(
		IpcChannels.customizations.testMcpServers,
		async (_event, targets: McpTestTarget[]): Promise<McpTestResult[]> => {
			const results: McpTestResult[] = [];
			for (const target of targets) {
				const entry = readMcpEntry(target.name, target.scope, target.workspace);
				if (!entry) {
					results.push({ ...target, ok: false, error: "server not found", durationMs: 0 });
					continue;
				}
				if (entry.disabled === true) {
					results.push({ ...target, ok: false, error: "disabled", durationMs: 0 });
					continue;
				}
				results.push({ ...target, ...(await testMcpServer(entry)) });
			}
			return results;
		},
	);
}

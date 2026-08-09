import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import { IpcChannels } from "../shared/protocol";
import { createWorkspaceStore, type WorkspaceStore } from "./workspace-store";
import { startWorkspaceWatch, stopWorkspaceWatch } from "./fs-watch-host";
import {
	mergeRecentWithPiCliWorkspaces,
	workspacePathsEqual,
} from "./session-list";
import { clearProjectTrust } from "./project-trust";

let store: WorkspaceStore | null = null;

export type WorkspaceIpcDeps = {
	/** Kill workers + delete Pi session files for a workspace (not the project dir). */
	purgeWorkspaceSessions?: (cwd: string) => Promise<void>;
};

let deps: WorkspaceIpcDeps = {};

function getStore(): WorkspaceStore {
	if (!store) {
		const statePath = path.join(
			app.getPath("userData"),
			"workspace-state.json",
		);
		store = createWorkspaceStore(statePath);
	}
	return store;
}

export function getWorkspace(): string | null {
	return getStore().getRoot();
}

export function listRecentDesktop(): string[] {
	return getStore().listRecent();
}

/**
 * Instant: Desktop-pinned recent only (no SessionManager.listAll scan).
 * Used on cold start so the shell paints before Pi CLI discovery finishes.
 */
export function listRecentDesktopOnly(): string[] {
	return listRecentDesktop().map((p) => path.resolve(p));
}

/** Desktop recent + workspaces discovered from Pi CLI session store. */
export async function listRecent(): Promise<string[]> {
	const s = getStore();
	return mergeRecentWithPiCliWorkspaces(s.listRecent(), s.listDismissedPi());
}

/** Keep exactly one watcher bound to the active workspace root. */
function syncWorkspaceWatch(root: string | null): void {
	if (root) startWorkspaceWatch(root);
	else stopWorkspaceWatch();
}

export async function openWorkspacePath(root: string): Promise<string | null> {
	getStore().setRoot(root);
	getStore().addRecent(root);
	const next = getStore().getRoot();
	syncWorkspaceWatch(next);
	return next;
}

/** Folder picker only — does not change the active workspace root. */
export async function pickWorkspace(): Promise<string | null> {
	const win =
		BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
	const opts = { properties: ["openDirectory" as const] };
	const result = win
		? await dialog.showOpenDialog(win, opts)
		: await dialog.showOpenDialog(opts);
	if (result.canceled || result.filePaths.length === 0) {
		return null;
	}
	return result.filePaths[0] ?? null;
}

/** @deprecated Prefer pick + openPath after trust; kept for API compatibility. */
export async function openWorkspace(): Promise<string | null> {
	const picked = await pickWorkspace();
	if (!picked) return null;
	return openWorkspacePath(picked);
}

export async function clearWorkspace(): Promise<null> {
	getStore().setRoot(null);
	syncWorkspaceWatch(null);
	return null;
}

/**
 * Forget a workspace from Desktop config and delete its Pi sessions.
 * Never deletes the project directory on disk.
 */
export async function purgeWorkspace(root: string): Promise<{
	root: string | null;
	recent: string[];
}> {
	const cwd = path.resolve(root);
	try {
		await deps.purgeWorkspaceSessions?.(cwd);
	} catch (err) {
		console.error("[pi-desktop] purge workspace sessions failed", err);
		throw err;
	}
	try {
		clearProjectTrust(cwd);
	} catch {
		// trust store optional
	}
	getStore().forget(cwd);
	const next = getStore().getRoot();
	syncWorkspaceWatch(next);
	return { root: next, recent: await listRecent() };
}

export function registerWorkspaceIpc(nextDeps: WorkspaceIpcDeps = {}): void {
	deps = nextDeps;

	ipcMain.handle(IpcChannels.workspace.get, () => {
		const root = getWorkspace();
		// App start / reload: attach the single watcher for the restored workspace
		syncWorkspaceWatch(root);
		return root;
	});

	ipcMain.handle(IpcChannels.workspace.listRecent, () => listRecent());

	ipcMain.handle(IpcChannels.workspace.listRecentDesktop, () => listRecentDesktopOnly());

	/** Closed (dismissed) workspaces still known to Desktop — re-openable. */
	ipcMain.handle(IpcChannels.workspace.listClosed, () => {
		return getStore().listDismissedPi();
	});

	ipcMain.handle(IpcChannels.workspace.openPath, (_event, root: string) =>
		openWorkspacePath(root),
	);

	ipcMain.handle(IpcChannels.workspace.pick, () => pickWorkspace());

	ipcMain.handle(IpcChannels.workspace.open, () => pickWorkspace());

	ipcMain.handle(IpcChannels.workspace.clear, () => clearWorkspace());

	ipcMain.handle(
		IpcChannels.workspace.removeRecent,
		async (_event, root: string) => {
			getStore().removeRecent(root);
			const next = getStore().getRoot();
			syncWorkspaceWatch(next);
			return { root: next, recent: await listRecent() };
		},
	);

	/** Forget workspace config + purge Pi sessions (keeps project folder). */
	ipcMain.handle(IpcChannels.workspace.purge, (_event, root: string) =>
		purgeWorkspace(root),
	);

	ipcMain.handle(
		IpcChannels.workspace.reorderRecent,
		async (_event, order: string[]) => {
			const list = Array.isArray(order)
				? order.filter((entry): entry is string => typeof entry === "string")
				: [];
			// Only reorder paths that are already pinned in Desktop recent;
			// Pi-discovered-only roots stay appended after Desktop order.
			const desktop = new Set(listRecentDesktop().map((p) => path.resolve(p)));
			const desktopOrder = list.filter((p) =>
				[...desktop].some((d) => workspacePathsEqual(d, p)),
			);
			getStore().reorderRecent(desktopOrder);
			return listRecent();
		},
	);
	ipcMain.handle(
		IpcChannels.workspace.revealInFolder,
		async (_event, root: string) => {
			if (!root?.trim()) return;
			await shell.openPath(root);
		},
	);
}

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { IpcChannels } from "../shared/protocol";
import { createWorkspaceStore, type WorkspaceStore } from "./workspace-store";
import { startWorkspaceWatch, stopWorkspaceWatch } from "./fs-watch-host";
import {
	mergeRecentWithPiCliWorkspaces,
	migrateWorkspaceSessionDir,
	workspacePathsEqual,
} from "./session-list";

let store: WorkspaceStore | null = null;

export type WorkspaceIpcDeps = {
	/** Kill workers + delete Pi session files for a workspace (not the project dir). */
	purgeWorkspaceSessions?: (cwd: string) => Promise<void>;
	/** Close workers of a workspace without touching its session files. */
	stopWorkspaceSessions?: (cwd: string) => Promise<void>;
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
 *
 * Blank entries are filtered: the sidebar renders `basename(root)`, so a blank
 * root shows up as a nameless extra workspace.
 */
export function listRecentDesktopOnly(): string[] {
	return listRecentDesktop()
		.map((p) => p.trim())
		.filter((p) => p.length > 0)
		.map((p) => path.resolve(p));
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
	getStore().forget(cwd);
	const next = getStore().getRoot();
	syncWorkspaceWatch(next);
	return { root: next, recent: await listRecent() };
}

function listAliases(): Record<string, string> {
  return getStore().listAliases();
}

/** 设置工作区显示名；name 为 null / 空串时清除。 */
function setWorkspaceAlias(
  root: string,
  name: string | null,
): Record<string, string> {
  getStore().setAlias(root, name);
  return getStore().listAliases();
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 重新定位：新目录接管旧工作区的配置记录与 Pi 会话。
 * 先断开旧工作区的 worker，避免会话文件被搬移时还有写入。
 */
async function relocateWorkspace(
  root: string,
  next: string,
): Promise<{
  root: string | null;
  recent: string[];
  aliases: Record<string, string>;
}> {
  const from = path.resolve(root);
  const to = path.resolve(next);
  if (!workspacePathsEqual(from, to)) {
    if (!isDirectory(to)) throw new Error("target folder not found");
    await deps.stopWorkspaceSessions?.(from);
    await migrateWorkspaceSessionDir(from, to);
    getStore().replacePath(from, to);
  }
  const active = getStore().getRoot();
  syncWorkspaceWatch(active);
  return {
    root: active,
    recent: await listRecent(),
    aliases: getStore().listAliases(),
  };
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

	ipcMain.handle(IpcChannels.workspace.listAliases, () => listAliases());

	ipcMain.handle(
		IpcChannels.workspace.setAlias,
		(_event, root: string, name: string | null) => setWorkspaceAlias(root, name),
	);

	ipcMain.handle(
		IpcChannels.workspace.relocate,
		(_event, root: string, next: string) => relocateWorkspace(root, next),
	);
}

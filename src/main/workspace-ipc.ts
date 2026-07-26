import { app, dialog, ipcMain } from "electron";
import path from "node:path";
import { IpcChannels } from "../shared/protocol";
import { createWorkspaceStore, type WorkspaceStore } from "./workspace-store";

let store: WorkspaceStore | null = null;

function getStore(): WorkspaceStore {
  if (!store) {
    const statePath = path.join(app.getPath("userData"), "workspace-state.json");
    store = createWorkspaceStore(statePath);
  }
  return store;
}

export function getWorkspace(): string | null {
  return getStore().getRoot();
}

export function listRecent(): string[] {
  return getStore().listRecent();
}

export async function openWorkspacePath(root: string): Promise<string | null> {
  getStore().setRoot(root);
  getStore().addRecent(root);
  return getStore().getRoot();
}

export async function openWorkspace(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return getStore().getRoot();
  }
  const root = result.filePaths[0];
  return openWorkspacePath(root);
}

export function registerWorkspaceIpc(): void {
  ipcMain.handle(IpcChannels.workspace.get, () => getWorkspace());

  ipcMain.handle(IpcChannels.workspace.listRecent, () => listRecent());

  ipcMain.handle(IpcChannels.workspace.openPath, (_event, root: string) =>
    openWorkspacePath(root),
  );

  ipcMain.handle(IpcChannels.workspace.open, () => openWorkspace());
}

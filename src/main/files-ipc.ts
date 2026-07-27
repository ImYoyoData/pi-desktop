import { ipcMain, shell } from "electron";
import path from "node:path";
import { IpcChannels } from "../shared/protocol";
import {
  createWorkspaceDir,
  createWorkspaceFile,
  deleteWorkspaceEntry,
  listWorkspaceDir,
  moveWorkspaceEntry,
  renameWorkspaceEntry,
} from "./files-host";
import { getWorkspace } from "./workspace-ipc";
import { resolveWorkspacePath } from "../shared/path-sandbox";

export function registerFilesIpc(): void {
  ipcMain.handle(IpcChannels.files.list, (_event, relativePath?: string) => {
    const root = getWorkspace();
    if (!root) return [];
    return listWorkspaceDir(root, relativePath ?? "");
  });

  ipcMain.handle(
    IpcChannels.files.createFile,
    (_event, relativeDir: string, name: string) => {
      const root = getWorkspace();
      if (!root) throw new Error("未打开工作区");
      return createWorkspaceFile(root, relativeDir ?? "", name);
    },
  );

  ipcMain.handle(
    IpcChannels.files.createDir,
    (_event, relativeDir: string, name: string) => {
      const root = getWorkspace();
      if (!root) throw new Error("未打开工作区");
      return createWorkspaceDir(root, relativeDir ?? "", name);
    },
  );

  ipcMain.handle(
    IpcChannels.files.rename,
    (_event, relativePath: string, newName: string) => {
      const root = getWorkspace();
      if (!root) throw new Error("未打开工作区");
      return renameWorkspaceEntry(root, relativePath, newName);
    },
  );

  ipcMain.handle(
    IpcChannels.files.move,
    (_event, relativePath: string, destRelativeDir: string) => {
      const root = getWorkspace();
      if (!root) throw new Error("未打开工作区");
      return moveWorkspaceEntry(root, relativePath, destRelativeDir ?? "");
    },
  );

  ipcMain.handle(IpcChannels.files.delete, (_event, relativePath: string) => {
    const root = getWorkspace();
    if (!root) throw new Error("未打开工作区");
    deleteWorkspaceEntry(root, relativePath);
  });

  ipcMain.handle(IpcChannels.files.reveal, async (_event, relativePath: string) => {
    const root = getWorkspace();
    if (!root) throw new Error("未打开工作区");
    const abs = resolveWorkspacePath(root, relativePath || ".");
    await shell.showItemInFolder(path.resolve(abs));
  });
}

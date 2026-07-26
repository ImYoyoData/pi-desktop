import path from "node:path";
import { dialog, ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import { resolveWorkspacePath } from "../shared/path-sandbox";
import { readPreview } from "./preview-host";
import { getWorkspace } from "./workspace-ipc";

export function registerPreviewIpc(): void {
  ipcMain.handle(IpcChannels.preview.read, (_event, filePath: string) => {
    const root = getWorkspace();
    if (!root) {
      return { kind: "error", message: "Open a workspace folder first" } as const;
    }
    return readPreview(root, filePath);
  });

  ipcMain.handle(IpcChannels.preview.pickFile, async () => {
    const root = getWorkspace();
    if (!root) {
      return null;
    }
    const result = await dialog.showOpenDialog({
      defaultPath: root,
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const picked = result.filePaths[0];
    try {
      const absolute = resolveWorkspacePath(root, picked);
      return path.relative(root, absolute).split(path.sep).join("/");
    } catch {
      return null;
    }
  });
}

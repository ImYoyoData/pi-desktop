import path from "node:path";
import fs from "node:fs";
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

  ipcMain.handle(IpcChannels.preview.write, (_event, filePath: string, content: string) => {
    const root = getWorkspace();
    if (!root) throw new Error("未打开工作区");
    const absolute = resolveWorkspacePath(root, filePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, "utf8");
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

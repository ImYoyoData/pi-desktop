import path from "node:path";
import fs from "node:fs";
import { BrowserWindow, dialog, ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import { isPathInsideRoot } from "../shared/path-sandbox";
import { readPreviewAt } from "./preview-host";
import { resolvePreviewReadPath, resolvePreviewWritePath } from "./preview-paths";
import { agentDir } from "./agent-dir";
import { getWorkspace } from "./workspace-ipc";
import { withoutAsar } from "./workspace-fs";

function dialogParent(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

export function registerPreviewIpc(): void {
  ipcMain.handle(IpcChannels.preview.read, (_event, filePath: string) => {
    const root = getWorkspace();
    if (!root) {
      return { kind: "error", message: "Open a workspace folder first" } as const;
    }
    try {
      return readPreviewAt(root, resolvePreviewReadPath(root, filePath));
    } catch (err) {
      return {
        kind: "error",
        path: filePath,
        message: err instanceof Error ? err.message : String(err),
      } as const;
    }
  });

  ipcMain.handle(IpcChannels.preview.write, (_event, filePath: string, content: string) => {
    const root = getWorkspace();
    if (!root) throw new Error("Open a workspace folder first");
    const absolute = resolvePreviewWritePath(root, filePath, agentDir());
    withoutAsar(() => {
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, content, "utf8");
    });
  });

  ipcMain.handle(IpcChannels.preview.pickFile, async () => {
    const root = getWorkspace();
    if (!root) {
      return null;
    }
    const win = dialogParent();
    const opts = {
      defaultPath: root,
      properties: ["openFile" as const],
    };
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const picked = result.filePaths[0];
    if (!isPathInsideRoot(root, picked)) return picked.split(path.sep).join("/");
    return path.relative(root, picked).split(path.sep).join("/");
  });
}

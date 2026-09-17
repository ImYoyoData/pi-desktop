import path from "node:path";
import fs from "node:fs";
import { BrowserWindow, dialog, ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import { isPathInsideRoot, resolveWorkspacePath } from "../shared/path-sandbox";
import { readPreviewAt } from "./preview-host";
import { agentDir } from "./agent-dir";
import { getWorkspace } from "./workspace-ipc";

function dialogParent(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

/**
 * 预览读取路径：绝对路径按原样（工作区外的本地文件也可预览），
 * 相对路径相对工作区解析。
 */
function resolvePreviewReadPath(root: string, filePath: string): string {
  return path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(root, filePath);
}

/**
 * 预览写入路径：工作区内，或 pi 用户资源目录（~/.pi/agent）——
 * 智能体设置页需要编辑用户级/扩展级定制文件。
 */
function resolvePreviewWritePath(root: string, filePath: string): string {
  try {
    return resolveWorkspacePath(root, filePath);
  } catch (err) {
    const resolved = path.resolve(filePath);
    if (isPathInsideRoot(agentDir(), resolved)) return resolved;
    throw err;
  }
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
    const absolute = resolvePreviewWritePath(root, filePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, "utf8");
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

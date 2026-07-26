import { randomUUID } from "node:crypto";
import { BrowserWindow, ipcMain } from "electron";
import * as pty from "node-pty";
import { IpcChannels } from "../shared/protocol";
import { getWorkspace } from "./workspace-ipc";
import { resolveTerminalShell } from "./terminal-shell";

const terminals = new Map<string, pty.IPty>();

function broadcastTerminalData(id: string, data: string): void {
  const payload = { id, data };
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.terminal.data, payload);
  }
}

export function registerTerminalIpc(): void {
  ipcMain.handle(IpcChannels.terminal.create, (_event, cwd?: string) => {
    const root = cwd?.trim() || getWorkspace();
    if (!root) {
      throw new Error("workspace required to create terminal");
    }
    const id = randomUUID();
    const shell = resolveTerminalShell();
    const term = pty.spawn(shell, [], {
      name: "xterm-color",
      cwd: root,
      env: process.env as Record<string, string>,
    });
    term.onData((data) => {
      broadcastTerminalData(id, data);
    });
    term.onExit(() => {
      terminals.delete(id);
    });
    terminals.set(id, term);
    return id;
  });

  ipcMain.handle(IpcChannels.terminal.write, (_event, id: string, data: string) => {
    terminals.get(id)?.write(data);
  });

  ipcMain.handle(
    IpcChannels.terminal.resize,
    (_event, id: string, cols: number, rows: number) => {
      try {
        terminals.get(id)?.resize(cols, rows);
      } catch {
        // Ignore resize races when pty is disposed.
      }
    },
  );

  ipcMain.handle(IpcChannels.terminal.dispose, (_event, id: string) => {
    const term = terminals.get(id);
    if (!term) {
      return;
    }
    term.kill();
    terminals.delete(id);
  });
}

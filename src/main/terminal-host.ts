import { BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import * as pty from "node-pty";
import { IpcChannels } from "../shared/protocol";
import { getWorkspace } from "./workspace-ipc";
import { resolveTerminalShell } from "./terminal-shell";

const terminals = new Map<string, pty.IPty>();
/** Ring buffer of recent output so UI can re-attach after workspace switch. */
const scrollbacks = new Map<string, string>();
const SCROLLBACK_MAX = 200_000;

/** Coalesce high-frequency pty output so the renderer isn't flooded. */
const pendingData = new Map<string, string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_MS = 16;
/** Cap a single flush so one huge dump can't freeze the UI for seconds. */
const MAX_CHUNK = 64 * 1024;

function appendScrollback(id: string, data: string): void {
  const prev = scrollbacks.get(id) ?? "";
  let next = prev + data;
  if (next.length > SCROLLBACK_MAX) {
    next = next.slice(next.length - SCROLLBACK_MAX);
  }
  scrollbacks.set(id, next);
}

function flushTerminalData(): void {
  flushTimer = null;
  if (!pendingData.size) return;
  const batch = [...pendingData.entries()];
  pendingData.clear();
  const windows = BrowserWindow.getAllWindows();
  if (!windows.length) return;
  for (const [id, raw] of batch) {
    let data = raw;
    while (data.length) {
      const chunk = data.slice(0, MAX_CHUNK);
      data = data.slice(MAX_CHUNK);
      const payload = { id, data: chunk };
      for (const win of windows) {
        win.webContents.send(IpcChannels.terminal.data, payload);
      }
    }
  }
}

function queueTerminalData(id: string, data: string): void {
  appendScrollback(id, data);
  pendingData.set(id, (pendingData.get(id) ?? "") + data);
  if (flushTimer == null) {
    flushTimer = setTimeout(flushTerminalData, FLUSH_MS);
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
    const term = pty.spawn(shell.file, shell.args, {
      name: "xterm-color",
      cwd: root,
      env: process.env as Record<string, string>,
    });
    scrollbacks.set(id, "");
    term.onData((data) => {
      queueTerminalData(id, data);
    });
    term.onExit(() => {
      pendingData.delete(id);
      scrollbacks.delete(id);
      terminals.delete(id);
    });
    terminals.set(id, term);
    return id;
  });

  ipcMain.handle(IpcChannels.terminal.isAlive, (_event, id: string) => {
    return terminals.has(id);
  });

  ipcMain.handle(IpcChannels.terminal.getScrollback, (_event, id: string) => {
    if (!terminals.has(id)) return null;
    return scrollbacks.get(id) ?? "";
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
    pendingData.delete(id);
    scrollbacks.delete(id);
    if (!term) {
      return;
    }
    term.kill();
    terminals.delete(id);
  });
}

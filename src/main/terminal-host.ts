import { BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import * as pty from "node-pty";
import { IpcChannels } from "../shared/protocol";
import { getWorkspace } from "./workspace-ipc";
import { resolveTerminalShell } from "./terminal-shell";
import { isWindowHidden, onWindowShown } from "./window-visibility";

const terminals = new Map<string, pty.IPty>();
/** Ring buffer of recent output so UI can re-attach after workspace switch. */
const scrollbacks = new Map<string, string>();
const SCROLLBACK_MAX = 200_000;

/** Coalesce high-frequency pty output so the renderer isn't flooded. */
const pendingData = new Map<string, string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_MS = 16;
/** Cap a single IPC payload so one huge dump can't freeze the UI for seconds. */
const MAX_CHUNK = 64 * 1024;
/**
 * Max bytes flushed per tick across all terminals. webContents.send serializes
 * synchronously in the main process, so an uncapped batch (e.g. `Get-Content
 * -Wait` on a big file) freezes the whole app. Anything over the budget stays
 * pending and flushes on the next tick.
 */
const FLUSH_BUDGET = 1024 * 1024;
/** Hard cap per-terminal pending bytes so pausing while hidden stays bounded. */
const MAX_PENDING = 2 * 1024 * 1024;
/** Poll interval while the window is hidden (no IPC, keeps the newest data). */
const HIDDEN_RETRY_MS = 250;

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
  // No window is visible (e.g. minimized): hold the newest data and stop IPC.
  // Flushing while hidden used to pile up synchronous sends that froze the
  // whole app when the window was restored.
  if (isWindowHidden()) {
    flushTimer = setTimeout(flushTerminalData, HIDDEN_RETRY_MS);
    return;
  }
  const windows = BrowserWindow.getAllWindows();
  if (!windows.length) return;
  let budget = FLUSH_BUDGET;
  for (const [id, raw] of [...pendingData.entries()]) {
    if (budget <= 0) break;
    const sendNow = raw.slice(0, budget);
    const rest = raw.slice(budget);
    budget -= sendNow.length;
    if (rest) {
      pendingData.set(id, rest);
    } else {
      pendingData.delete(id);
    }
    let data = sendNow;
    while (data.length) {
      const chunk = data.slice(0, MAX_CHUNK);
      data = data.slice(MAX_CHUNK);
      const payload = { id, data: chunk };
      for (const win of windows) {
        win.webContents.send(IpcChannels.terminal.data, payload);
      }
    }
    if (budget <= 0) break;
  }
  // Overflow stays pending — keep draining on subsequent ticks so no data is lost.
  if (pendingData.size && flushTimer == null) {
    flushTimer = setTimeout(flushTerminalData, FLUSH_MS);
  }
}

function queueTerminalData(id: string, data: string): void {
  appendScrollback(id, data);
  let next = (pendingData.get(id) ?? "") + data;
  if (next.length > MAX_PENDING) {
    // Keep the newest data; the UI renders the tail, not the middle.
    next = next.slice(next.length - MAX_PENDING);
  }
  pendingData.set(id, next);
  if (flushTimer == null) {
    flushTimer = setTimeout(flushTerminalData, FLUSH_MS);
  }
}

export function registerTerminalIpc(): void {
  // Drain anything buffered while the window was hidden as soon as it shows.
  onWindowShown(() => {
    if (pendingData.size && flushTimer == null) {
      flushTerminalData();
    }
  });

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

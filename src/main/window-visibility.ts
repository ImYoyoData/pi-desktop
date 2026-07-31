import { BrowserWindow } from "electron";

/**
 * Main-process window visibility.
 *
 * High-frequency IPC work (terminal data flushing, agent run-output batching)
 * is paused while every window is hidden/minimized. Restoring the window used
 * to burst a backlog of synchronous webContents.send() calls in the main
 * process, which froze the whole app (including the restore itself).
 */
let hidden = false;
const shownListeners = new Set<() => void>();

export function bindWindowVisibility(win: BrowserWindow): void {
  win.on("minimize", () => setWindowHidden(true));
  win.on("restore", () => setWindowHidden(false));
  win.on("hide", () => setWindowHidden(true));
  win.on("show", () => setWindowHidden(false));
}

export function isWindowHidden(): boolean {
  return hidden;
}

export function setWindowHidden(v: boolean): void {
  if (hidden === v) return;
  hidden = v;
  if (!v) {
    for (const cb of [...shownListeners]) {
      try {
        cb();
      } catch {
        // A failing listener must never block the rest.
      }
    }
  }
}

/** Fire the callback when a window becomes visible again (e.g. restored from minimized). */
export function onWindowShown(cb: () => void): () => void {
  shownListeners.add(cb);
  return () => {
    shownListeners.delete(cb);
  };
}

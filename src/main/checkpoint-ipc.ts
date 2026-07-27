import { BrowserWindow, ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import {
  beginCheckpoint,
  finishActiveCheckpoint,
  finishCheckpoint,
  getCheckpointSummary,
  revertCheckpoint,
  type CheckpointSummary,
} from "./checkpoint-host";
import { getWorkspace } from "./workspace-ipc";
import { flushPendingFsWatch } from "./fs-watch-host";

function broadcastUpdated(summary: CheckpointSummary): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.checkpoint.updated, summary);
  }
}

export function registerCheckpointIpc(): void {
  ipcMain.handle(
    IpcChannels.checkpoint.begin,
    (_event, sessionId: string, userMessageId: string): CheckpointSummary => {
      return beginCheckpoint(sessionId, userMessageId, getWorkspace());
    },
  );

  ipcMain.handle(
    IpcChannels.checkpoint.finish,
    (_event, sessionId: string, userMessageId: string): CheckpointSummary => {
      flushPendingFsWatch();
      const summary = finishCheckpoint(sessionId, userMessageId);
      if (summary.status === "ready" || summary.status === "empty" || summary.status === "reverted") {
        broadcastUpdated(summary);
      }
      return summary;
    },
  );

  ipcMain.handle(
    IpcChannels.checkpoint.finishActive,
    (_event, sessionId: string): CheckpointSummary | null => {
      flushPendingFsWatch();
      const summary = finishActiveCheckpoint(sessionId);
      if (summary) broadcastUpdated(summary);
      return summary;
    },
  );

  ipcMain.handle(
    IpcChannels.checkpoint.get,
    (_event, sessionId: string, userMessageId: string): CheckpointSummary | null => {
      return getCheckpointSummary(sessionId, userMessageId);
    },
  );

  ipcMain.handle(
    IpcChannels.checkpoint.revert,
    (_event, sessionId: string, userMessageId: string) => {
      const result = revertCheckpoint(sessionId, userMessageId, getWorkspace());
      const summary = getCheckpointSummary(sessionId, userMessageId);
      if (summary) broadcastUpdated(summary);
      return result;
    },
  );
}

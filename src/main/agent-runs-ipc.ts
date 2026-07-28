import { BrowserWindow, ipcMain } from "electron";
import type { AgentRunEvent, AgentRunSnapshot } from "../shared/agent-runs";
import { IpcChannels } from "../shared/protocol";

export function registerAgentRunsIpc(registry: {
  list: (workspaceRoot: string) => AgentRunSnapshot[];
  terminate: (runId: string) => Promise<void>;
}): void {
  ipcMain.handle(IpcChannels.runs.list, (_e, workspaceRoot: string) =>
    registry.list(workspaceRoot ?? ""),
  );
  ipcMain.handle(IpcChannels.runs.terminate, (_e, runId: string) =>
    registry.terminate(runId),
  );
}

export function broadcastRunsEvent(event: AgentRunEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.runs.event, event);
  }
}

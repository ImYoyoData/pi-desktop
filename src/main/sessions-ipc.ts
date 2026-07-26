import { BrowserWindow, ipcMain } from "electron";
import type { AgentCommand } from "../shared/protocol";
import { IpcChannels } from "../shared/protocol";
import type { SessionBroker } from "./session-broker";

function broadcastEvent(event: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.sessions.event, event);
  }
}

export function registerSessionsIpc(broker: SessionBroker): void {
  broker.onEvent((event) => {
    broadcastEvent(event);
  });

  ipcMain.handle(IpcChannels.sessions.list, () => broker.listSessions());

  ipcMain.handle(IpcChannels.sessions.create, (_event, cwd: string) => broker.createSession(cwd));

  ipcMain.handle(IpcChannels.sessions.close, (_event, sessionId: string) =>
    broker.closeSession(sessionId),
  );

  ipcMain.handle(IpcChannels.sessions.command, (_event, sessionId: string, command: AgentCommand) =>
    broker.send(sessionId, command),
  );

  ipcMain.handle(IpcChannels.sessions.killWorker, (_event, sessionId: string) =>
    broker.killWorker(sessionId),
  );

  ipcMain.handle(IpcChannels.sessions.restartWorker, (_event, sessionId: string) =>
    broker.restartWorker(sessionId),
  );

  ipcMain.handle(IpcChannels.sessions.status, (_event, sessionId: string) => {
    const list = broker.listSessions();
    return list.find((s) => s.id === sessionId)?.status ?? null;
  });

  ipcMain.handle(IpcChannels.sessions.open, (_event, sessionId: string) => {
    const list = broker.listSessions();
    return list.find((s) => s.id === sessionId) ?? null;
  });
}

import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import type { AgentCommand, AgentEvent, SessionStatus, SessionSummary } from "../shared/protocol";
import { IpcChannels } from "../shared/protocol";

const api = {
  workspace: {
    get: () => ipcRenderer.invoke(IpcChannels.workspace.get) as Promise<string | null>,
    open: () => ipcRenderer.invoke(IpcChannels.workspace.open) as Promise<string | null>,
    listRecent: () => ipcRenderer.invoke(IpcChannels.workspace.listRecent) as Promise<string[]>,
    openPath: (root: string) =>
      ipcRenderer.invoke(IpcChannels.workspace.openPath, root) as Promise<string | null>,
  },
  sessions: {
    list: () => ipcRenderer.invoke(IpcChannels.sessions.list) as Promise<SessionSummary[]>,
    create: (cwd: string) =>
      ipcRenderer.invoke(IpcChannels.sessions.create, cwd) as Promise<SessionSummary>,
    open: (sessionId: string) =>
      ipcRenderer.invoke(IpcChannels.sessions.open, sessionId) as Promise<SessionSummary | null>,
    close: (sessionId: string) => ipcRenderer.invoke(IpcChannels.sessions.close, sessionId) as Promise<void>,
    command: (sessionId: string, command: AgentCommand) =>
      ipcRenderer.invoke(IpcChannels.sessions.command, sessionId, command) as Promise<void>,
    killWorker: (sessionId: string) =>
      ipcRenderer.invoke(IpcChannels.sessions.killWorker, sessionId) as Promise<void>,
    restartWorker: (sessionId: string) =>
      ipcRenderer.invoke(IpcChannels.sessions.restartWorker, sessionId) as Promise<void>,
    status: (sessionId: string) =>
      ipcRenderer.invoke(IpcChannels.sessions.status, sessionId) as Promise<SessionStatus | null>,
    onEvent: (callback: (event: AgentEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: AgentEvent) => callback(payload);
      ipcRenderer.on(IpcChannels.sessions.event, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.sessions.event, listener);
      };
    },
  },
};

export type PiDesktopApi = typeof api;

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-expect-error define in dts
  window.electron = electronAPI;
  // @ts-expect-error define in dts
  window.api = api;
}

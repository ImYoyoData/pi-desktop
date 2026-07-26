import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import type { AgentCommand, AgentEvent, ElementCitation, SessionStatus, SessionSummary } from "../shared/protocol";
import { IpcChannels } from "../shared/protocol";
import type { ModelsGetResult, ModelsSetPayload } from "../shared/models-settings";
import type { PreviewResult } from "../shared/preview-types";

export type { AgentCommand, AgentEvent, ElementCitation, SessionStatus, SessionSummary };

const api = {
  workspace: {
    get: () => ipcRenderer.invoke(IpcChannels.workspace.get) as Promise<string | null>,
    open: () => ipcRenderer.invoke(IpcChannels.workspace.open) as Promise<string | null>,
    listRecent: () => ipcRenderer.invoke(IpcChannels.workspace.listRecent) as Promise<string[]>,
    openPath: (root: string) =>
      ipcRenderer.invoke(IpcChannels.workspace.openPath, root) as Promise<string | null>,
  },
  sessions: {
    list: (cwd: string) =>
      ipcRenderer.invoke(IpcChannels.sessions.list, cwd) as Promise<SessionSummary[]>,
    create: (cwd: string) =>
      ipcRenderer.invoke(IpcChannels.sessions.create, cwd) as Promise<SessionSummary>,
    open: (sessionId: string, cwd: string) =>
      ipcRenderer.invoke(IpcChannels.sessions.open, sessionId, cwd) as Promise<SessionSummary | null>,
    close: (sessionId: string) => ipcRenderer.invoke(IpcChannels.sessions.close, sessionId) as Promise<void>,
    command: (sessionId: string, command: AgentCommand) =>
      ipcRenderer.invoke(IpcChannels.sessions.command, sessionId, command) as Promise<void>,
    killWorker: (sessionId: string) =>
      ipcRenderer.invoke(IpcChannels.sessions.killWorker, sessionId) as Promise<void>,
    restartWorker: (sessionId: string) =>
      ipcRenderer.invoke(IpcChannels.sessions.restartWorker, sessionId) as Promise<void>,
    status: (sessionId: string, cwd: string) =>
      ipcRenderer.invoke(IpcChannels.sessions.status, sessionId, cwd) as Promise<SessionStatus | null>,
    onEvent: (callback: (event: AgentEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: AgentEvent) => callback(payload);
      ipcRenderer.on(IpcChannels.sessions.event, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.sessions.event, listener);
      };
    },
  },
  models: {
    get: () => ipcRenderer.invoke(IpcChannels.models.get) as Promise<ModelsGetResult>,
    set: (payload: ModelsSetPayload) =>
      ipcRenderer.invoke(IpcChannels.models.set, payload) as Promise<void>,
    test: () => ipcRenderer.invoke(IpcChannels.models.test) as Promise<ModelsGetResult["available"]>,
  },
  preview: {
    read: (filePath: string) =>
      ipcRenderer.invoke(IpcChannels.preview.read, filePath) as Promise<PreviewResult>,
    pickFile: () =>
      ipcRenderer.invoke(IpcChannels.preview.pickFile) as Promise<string | null>,
  },
  terminal: {
    create: (cwd?: string) =>
      ipcRenderer.invoke(IpcChannels.terminal.create, cwd) as Promise<string>,
    write: (id: string, data: string) =>
      ipcRenderer.invoke(IpcChannels.terminal.write, id, data) as Promise<void>,
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IpcChannels.terminal.resize, id, cols, rows) as Promise<void>,
    dispose: (id: string) =>
      ipcRenderer.invoke(IpcChannels.terminal.dispose, id) as Promise<void>,
    onData: (callback: (payload: { id: string; data: string }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { id: string; data: string },
      ) => callback(payload);
      ipcRenderer.on(IpcChannels.terminal.data, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.terminal.data, listener);
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

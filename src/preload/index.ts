import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import { IpcChannels } from "../shared/protocol";

const api = {
  workspace: {
    get: () => ipcRenderer.invoke(IpcChannels.workspace.get) as Promise<string | null>,
    open: () => ipcRenderer.invoke(IpcChannels.workspace.open) as Promise<string | null>,
    listRecent: () => ipcRenderer.invoke(IpcChannels.workspace.listRecent) as Promise<string[]>,
    openPath: (root: string) =>
      ipcRenderer.invoke(IpcChannels.workspace.openPath, root) as Promise<string | null>,
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

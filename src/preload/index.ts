import { contextBridge, ipcRenderer, webUtils } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import { createApi } from "../shared/api";
import type { ApiIpc } from "../shared/api";

export type { AppInfo, PiDesktopApi } from "../shared/api";
export type {
	AgentCommand,
	AgentEvent,
	ElementCitation,
	SessionHistoryMessage,
	SessionHistoryPage,
	SessionHistoryQuery,
	SessionStatus,
	SessionSummary,
} from "../shared/api";

type IpcListener = (
	event: Electron.IpcRendererEvent,
	...args: unknown[]
) => void;

const electronIpc: ApiIpc = {
	invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
	on: (channel, listener) => {
		ipcRenderer.on(channel, listener as unknown as IpcListener);
	},
	removeListener: (channel, listener) => {
		ipcRenderer.removeListener(channel, listener as unknown as IpcListener);
	},
	send: (channel, ...args) => {
		ipcRenderer.send(channel, ...args);
	},
	sendSync: (channel, ...args) => ipcRenderer.sendSync(channel, ...args),
};

const api = createApi(electronIpc, {
	getPathForFile: (file) => webUtils.getPathForFile(file),
});

if (process.contextIsolated) {
	try {
		contextBridge.exposeInMainWorld("electron", electronAPI);
		contextBridge.exposeInMainWorld("api", api);
	} catch (error) {
		console.error(error);
	}
} else {
	window.electron = electronAPI;
	window.api = api;
}

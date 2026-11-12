import { contextBridge, ipcRenderer, webUtils } from "electron";
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

/** 仅暴露版本号：完整 electronAPI 会带出 ipcRenderer 与 process.env。 */
const electronBridge = {
	process: { versions: process.versions },
};

if (process.contextIsolated) {
	try {
		contextBridge.exposeInMainWorld("electron", electronBridge);
		contextBridge.exposeInMainWorld("api", api);
	} catch (error) {
		console.error(error);
	}
} else {
	window.electron = electronBridge;
	window.api = api;
}

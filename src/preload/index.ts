import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import type { AgentCommand, AgentEvent, ElementCitation, SessionHistoryMessage, SessionStatus, SessionSummary } from "../shared/protocol";
import { IpcChannels } from "../shared/protocol";
import type { ModelsGetResult, ModelsSetPayload } from "../shared/models-settings";
import type { PreviewResult } from "../shared/preview-types";

export type { AgentCommand, AgentEvent, ElementCitation, SessionHistoryMessage, SessionStatus, SessionSummary };

const api = {
  window: {
    platform: () => ipcRenderer.invoke(IpcChannels.window.platform) as Promise<NodeJS.Platform>,
    minimize: () => ipcRenderer.invoke(IpcChannels.window.minimize) as Promise<void>,
    maximize: () => ipcRenderer.invoke(IpcChannels.window.maximize) as Promise<void>,
    close: () => ipcRenderer.invoke(IpcChannels.window.close) as Promise<void>,
    isMaximized: () => ipcRenderer.invoke(IpcChannels.window.isMaximized) as Promise<boolean>,
  },
  workspace: {
    get: () => ipcRenderer.invoke(IpcChannels.workspace.get) as Promise<string | null>,
    open: () => ipcRenderer.invoke(IpcChannels.workspace.open) as Promise<string | null>,
    listRecent: () => ipcRenderer.invoke(IpcChannels.workspace.listRecent) as Promise<string[]>,
    openPath: (root: string) =>
      ipcRenderer.invoke(IpcChannels.workspace.openPath, root) as Promise<string | null>,
    removeRecent: (root: string) =>
      ipcRenderer.invoke(IpcChannels.workspace.removeRecent, root) as Promise<{
        root: string | null;
        recent: string[];
      }>,
    revealInFolder: (root: string) =>
      ipcRenderer.invoke(IpcChannels.workspace.revealInFolder, root) as Promise<void>,
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
    delete: (sessionId: string, cwd: string) =>
      ipcRenderer.invoke(IpcChannels.sessions.delete, sessionId, cwd) as Promise<void>,
    rename: (sessionId: string, cwd: string, name: string) =>
      ipcRenderer.invoke(IpcChannels.sessions.rename, sessionId, cwd, name) as Promise<SessionSummary | null>,
    history: (filePath: string) =>
      ipcRenderer.invoke(IpcChannels.sessions.history, filePath) as Promise<SessionHistoryMessage[]>,
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
  files: {
    list: (relativePath?: string) =>
      ipcRenderer.invoke(IpcChannels.files.list, relativePath) as Promise<
        { name: string; path: string; kind: "file" | "dir" }[]
      >,
    createFile: (relativeDir: string, name: string) =>
      ipcRenderer.invoke(IpcChannels.files.createFile, relativeDir, name) as Promise<string>,
    createDir: (relativeDir: string, name: string) =>
      ipcRenderer.invoke(IpcChannels.files.createDir, relativeDir, name) as Promise<string>,
    rename: (relativePath: string, newName: string) =>
      ipcRenderer.invoke(IpcChannels.files.rename, relativePath, newName) as Promise<string>,
    delete: (relativePath: string) =>
      ipcRenderer.invoke(IpcChannels.files.delete, relativePath) as Promise<void>,
    reveal: (relativePath: string) =>
      ipcRenderer.invoke(IpcChannels.files.reveal, relativePath) as Promise<void>,
  },
  fs: {
    watch: (root: string) =>
      ipcRenderer.invoke(IpcChannels.fs.watch, root) as Promise<{ ok: boolean }>,
    unwatch: () => ipcRenderer.invoke(IpcChannels.fs.unwatch) as Promise<{ ok: boolean }>,
    onChanged: (
      callback: (payload: {
        root: string;
        events: { path: string; kind: "add" | "change" | "unlink" }[];
      }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: {
          root: string;
          events: { path: string; kind: "add" | "change" | "unlink" }[];
        },
      ) => callback(payload);
      ipcRenderer.on(IpcChannels.fs.changed, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.fs.changed, listener);
      };
    },
  },
  git: {
    status: () =>
      ipcRenderer.invoke(IpcChannels.git.status) as Promise<{
        isGitRepository: boolean;
        branch: string | null;
        files: { relativePath: string; status: string; code: string }[];
      }>,
    diff: (relativePath: string) =>
      ipcRenderer.invoke(IpcChannels.git.diff, relativePath) as Promise<{
        supported: boolean;
        status?: string;
        patch?: string;
      }>,
    branches: () =>
      ipcRenderer.invoke(IpcChannels.git.branches) as Promise<{
        current: string | null;
        local: string[];
      }>,
    checkout: (branch: string) =>
      ipcRenderer.invoke(IpcChannels.git.checkout, branch) as Promise<
        { ok: true; message?: string } | { ok: false; message: string }
      >,
    createBranch: (branch: string) =>
      ipcRenderer.invoke(IpcChannels.git.createBranch, branch) as Promise<
        { ok: true; message?: string } | { ok: false; message: string }
      >,
    merge: (branch: string) =>
      ipcRenderer.invoke(IpcChannels.git.merge, branch) as Promise<
        { ok: true; message?: string } | { ok: false; message: string }
      >,
    commit: (payload: { message: string; paths: string[] }) =>
      ipcRenderer.invoke(IpcChannels.git.commit, payload) as Promise<
        { ok: true; message?: string } | { ok: false; message: string }
      >,
    pull: () =>
      ipcRenderer.invoke(IpcChannels.git.pull) as Promise<
        { ok: true; message?: string } | { ok: false; message: string }
      >,
    push: () =>
      ipcRenderer.invoke(IpcChannels.git.push) as Promise<
        { ok: true; message?: string } | { ok: false; message: string }
      >,
  },
  skills: {
    list: (cwd?: string) =>
      ipcRenderer.invoke(IpcChannels.skills.list, cwd) as Promise<{
        skills: {
          name: string;
          description: string;
          filePath: string;
          baseDir: string;
          source: string;
          scope: string;
          disableModelInvocation: boolean;
        }[];
        diagnostics: string[];
      }>,
    setDisabled: (filePath: string, disableModelInvocation: boolean) =>
      ipcRenderer.invoke(
        IpcChannels.skills.setDisabled,
        filePath,
        disableModelInvocation,
      ) as Promise<void>,
    uninstall: (filePath: string, cwd?: string) =>
      ipcRenderer.invoke(IpcChannels.skills.uninstall, filePath, cwd) as Promise<void>,
  },
  plugins: {
    list: (cwd?: string) =>
      ipcRenderer.invoke(IpcChannels.plugins.list, cwd) as Promise<{
        packages: {
          source: string;
          scope: "global" | "project";
          disabled: boolean;
          installedPath?: string;
          status: "loaded" | "installed" | "missing" | "disabled";
        }[];
      }>,
    setEnabled: (
      source: string,
      scope: "global" | "project",
      enabled: boolean,
      cwd?: string,
    ) =>
      ipcRenderer.invoke(
        IpcChannels.plugins.setEnabled,
        source,
        scope,
        enabled,
        cwd,
      ) as Promise<{
        packages: {
          source: string;
          scope: "global" | "project";
          disabled: boolean;
          installedPath?: string;
          status: "loaded" | "installed" | "missing" | "disabled";
        }[];
      }>,
    remove: (source: string, scope: "global" | "project", cwd?: string) =>
      ipcRenderer.invoke(IpcChannels.plugins.remove, source, scope, cwd) as Promise<{
        packages: {
          source: string;
          scope: "global" | "project";
          disabled: boolean;
          installedPath?: string;
          status: "loaded" | "installed" | "missing" | "disabled";
        }[];
      }>,
  },
  models: {
    get: () => ipcRenderer.invoke(IpcChannels.models.get) as Promise<ModelsGetResult>,
    set: (payload: ModelsSetPayload) =>
      ipcRenderer.invoke(IpcChannels.models.set, payload) as Promise<void>,
    clearKey: (provider: string) =>
      ipcRenderer.invoke(IpcChannels.models.clearKey, provider) as Promise<void>,
    test: () => ipcRenderer.invoke(IpcChannels.models.test) as Promise<ModelsGetResult["available"]>,
  },
  preview: {
    read: (filePath: string) =>
      ipcRenderer.invoke(IpcChannels.preview.read, filePath) as Promise<PreviewResult>,
    write: (filePath: string, content: string) =>
      ipcRenderer.invoke(IpcChannels.preview.write, filePath, content) as Promise<void>,
    pickFile: () =>
      ipcRenderer.invoke(IpcChannels.preview.pickFile) as Promise<string | null>,
  },
  browser: {
    startSelect: (webContentsId: number) =>
      ipcRenderer.invoke(IpcChannels.browser.startSelect, webContentsId) as Promise<
        { ok: true } | { ok: false; reason: "csp" | "missing" }
      >,
    stopSelect: (webContentsId: number) =>
      ipcRenderer.invoke(IpcChannels.browser.stopSelect, webContentsId) as Promise<void>,
    openDevTools: (webContentsId: number) =>
      ipcRenderer.invoke(IpcChannels.browser.openDevTools, webContentsId) as Promise<void>,
    attachDevTools: (pageWebContentsId: number, devtoolsWebContentsId: number, open: boolean) =>
      ipcRenderer.invoke(
        IpcChannels.browser.attachDevTools,
        pageWebContentsId,
        devtoolsWebContentsId,
        open,
      ) as Promise<{ ok: boolean; open?: boolean }>,
    registerGuest: (pageWebContentsId: number) =>
      ipcRenderer.invoke(IpcChannels.browser.registerGuest, pageWebContentsId) as Promise<{
        ok: boolean;
      }>,
    openExternal: (url: string) =>
      ipcRenderer.invoke(IpcChannels.browser.openExternal, url) as Promise<void>,
    onElementSelected: (callback: (citation: ElementCitation) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: ElementCitation,
      ) => callback(payload);
      ipcRenderer.on(IpcChannels.browser.elementSelected, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.browser.elementSelected, listener);
      };
    },
    onToggleEmbeddedDevTools: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on(IpcChannels.browser.toggleEmbeddedDevTools, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.browser.toggleEmbeddedDevTools, listener);
      };
    },
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

import { contextBridge, ipcRenderer, webUtils } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import type { AgentCommand, AgentEvent, ElementCitation, SessionHistoryMessage, SessionStatus, SessionSummary } from "../shared/protocol";
import { IpcChannels } from "../shared/protocol";
import type { AgentRunEvent, AgentRunSnapshot } from "../shared/agent-runs";
import type { ModelsGetResult, ModelsSetPayload } from "../shared/models-settings";
import type { PreviewResult } from "../shared/preview-types";
import type { AsrInstallProgress, AsrStatus, AsrStreamEvent } from "../shared/asr";
import type { UpdateCheckResult, UpdateProgress } from "../shared/update";
import type {
  PiCliInstallProgress,
  PiCliInstallResult,
  PiCliStatus,
} from "../shared/pi-cli";
import type {
  PiPackageInstallResult,
  PiPackageListResult,
  PiPackageType,
} from "../shared/pi-market";
import type {
  DesktopSecuritySettings,
  PermissionAskReply,
  PermissionAskRequest,
} from "../shared/desktop-security";
import type {
  ExtensionUiEvent,
  ExtensionUiReply,
} from "../shared/extension-ui";
import type { TrustState } from "../shared/protocol";
import type { GitConflictContentResult, GitOpResult } from "../shared/git-types";

export type AppInfo = {
  version: string;
  githubUrl: string;
  releasesUrl: string;
  author: string;
  qq: string;
  email: string;
};

export type { UpdateProgress };

export type { AgentCommand, AgentEvent, ElementCitation, SessionHistoryMessage, SessionStatus, SessionSummary };

const api = {
  window: {
    platform: () => ipcRenderer.invoke(IpcChannels.window.platform) as Promise<NodeJS.Platform>,
    minimize: () => ipcRenderer.invoke(IpcChannels.window.minimize) as Promise<void>,
    maximize: () => ipcRenderer.invoke(IpcChannels.window.maximize) as Promise<void>,
    close: () => ipcRenderer.invoke(IpcChannels.window.close) as Promise<void>,
    forceClose: () => ipcRenderer.invoke(IpcChannels.window.forceClose) as Promise<void>,
    isMaximized: () => ipcRenderer.invoke(IpcChannels.window.isMaximized) as Promise<boolean>,
    setThemeSource: (source: "system" | "light" | "dark") =>
      ipcRenderer.invoke(IpcChannels.window.setThemeSource, source) as Promise<void>,
    setChromeTheme: (mode: "light" | "dark") =>
      ipcRenderer.invoke(IpcChannels.window.setChromeTheme, mode) as Promise<void>,
    setUiLocale: (locale: "zh-CN" | "en") =>
      ipcRenderer.invoke(IpcChannels.window.setUiLocale, locale) as Promise<void>,
    requestMediaAccess: (kind: "microphone" | "camera") =>
      ipcRenderer.invoke(IpcChannels.window.requestMediaAccess, kind) as Promise<boolean>,
    onCloseRequest: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on(IpcChannels.window.closeRequest, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.window.closeRequest, listener);
      };
    },
  },
  workspace: {
    get: () => ipcRenderer.invoke(IpcChannels.workspace.get) as Promise<string | null>,
    open: () => ipcRenderer.invoke(IpcChannels.workspace.open) as Promise<string | null>,
    pick: () => ipcRenderer.invoke(IpcChannels.workspace.pick) as Promise<string | null>,
    listRecent: () => ipcRenderer.invoke(IpcChannels.workspace.listRecent) as Promise<string[]>,
    openPath: (root: string) =>
      ipcRenderer.invoke(IpcChannels.workspace.openPath, root) as Promise<string | null>,
    clear: () => ipcRenderer.invoke(IpcChannels.workspace.clear) as Promise<null>,
    removeRecent: (root: string) =>
      ipcRenderer.invoke(IpcChannels.workspace.removeRecent, root) as Promise<{
        root: string | null;
        recent: string[];
      }>,
    reorderRecent: (order: string[]) =>
      ipcRenderer.invoke(IpcChannels.workspace.reorderRecent, order) as Promise<string[]>,
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
      ipcRenderer.invoke(IpcChannels.sessions.command, sessionId, command) as Promise<unknown>,
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
    clearContext: (sessionId: string, cwd: string) =>
      ipcRenderer.invoke(IpcChannels.sessions.clearContext, sessionId, cwd) as Promise<void>,
    status: (sessionId: string, cwd: string) =>
      ipcRenderer.invoke(IpcChannels.sessions.status, sessionId, cwd) as Promise<SessionStatus | null>,
    onEvent: (callback: (event: AgentEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: AgentEvent) => callback(payload);
      ipcRenderer.on(IpcChannels.sessions.event, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.sessions.event, listener);
      };
    },
    onPermission: (callback: (payload: PermissionAskRequest) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: PermissionAskRequest,
      ) => callback(payload);
      ipcRenderer.on(IpcChannels.sessions.permission, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.sessions.permission, listener);
      };
    },
    permissionReply: (payload: PermissionAskReply) =>
      ipcRenderer.invoke(IpcChannels.sessions.permissionReply, payload) as Promise<{
        ok: boolean;
        reason?: string;
      }>,
    onExtensionUi: (callback: (payload: ExtensionUiEvent) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: ExtensionUiEvent,
      ) => callback(payload);
      ipcRenderer.on(IpcChannels.sessions.extensionUi, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.sessions.extensionUi, listener);
      };
    },
    extensionUiReply: (payload: ExtensionUiReply) =>
      ipcRenderer.invoke(IpcChannels.sessions.extensionUiReply, payload) as Promise<{
        ok: boolean;
        reason?: string;
      }>,
  },
  runs: {
    list: (workspaceRoot: string) =>
      ipcRenderer.invoke(IpcChannels.runs.list, workspaceRoot) as Promise<AgentRunSnapshot[]>,
    terminate: (runId: string) =>
      ipcRenderer.invoke(IpcChannels.runs.terminate, runId) as Promise<void>,
    background: (runId: string) =>
      ipcRenderer.invoke(IpcChannels.runs.background, runId) as Promise<void>,
    onEvent: (callback: (event: AgentRunEvent) => void) => {
      const listener = (_: unknown, event: AgentRunEvent) => callback(event);
      ipcRenderer.on(IpcChannels.runs.event, listener);
      return () => ipcRenderer.removeListener(IpcChannels.runs.event, listener);
    },
  },
  files: {
    /** Electron 32+ removed File.path in renderer; resolve via preload webUtils. */
    getPathForFile: (file: File): string => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return "";
      }
    },
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
    move: (relativePath: string, destRelativeDir: string) =>
      ipcRenderer.invoke(IpcChannels.files.move, relativePath, destRelativeDir) as Promise<string>,
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
        errorCode?: string;
        errorMessage?: string;
      }>,
    diff: (relativePath: string) =>
      ipcRenderer.invoke(IpcChannels.git.diff, relativePath) as Promise<{
        supported: boolean;
        status?: string;
        patch?: string;
        oldContent?: string | null;
        newContent?: string | null;
      }>,
    branches: () =>
      ipcRenderer.invoke(IpcChannels.git.branches) as Promise<{
        current: string | null;
        local: string[];
        remote: string[];
      }>,
    checkout: (branch: string) =>
      ipcRenderer.invoke(IpcChannels.git.checkout, branch) as Promise<
        { ok: true; message?: string } | { ok: false; message: string; code: string }
      >,
    createBranch: (branch: string) =>
      ipcRenderer.invoke(IpcChannels.git.createBranch, branch) as Promise<
        { ok: true; message?: string } | { ok: false; message: string; code: string }
      >,
    merge: (branch: string) =>
      ipcRenderer.invoke(IpcChannels.git.merge, branch) as Promise<
        { ok: true; message?: string } | { ok: false; message: string; code: string }
      >,
    commit: (payload: { message: string; paths: string[] }) =>
      ipcRenderer.invoke(IpcChannels.git.commit, payload) as Promise<
        { ok: true; message?: string } | { ok: false; message: string; code: string }
      >,
    pull: () =>
      ipcRenderer.invoke(IpcChannels.git.pull) as Promise<
        { ok: true; message?: string } | { ok: false; message: string; code: string }
      >,
    push: () =>
      ipcRenderer.invoke(IpcChannels.git.push) as Promise<
        { ok: true; message?: string } | { ok: false; message: string; code: string }
      >,
    fetch: (remote?: string) =>
      ipcRenderer.invoke(IpcChannels.git.fetch, remote) as Promise<
        { ok: true; message?: string } | { ok: false; message: string; code: string }
      >,
    restore: (paths: string[]) =>
      ipcRenderer.invoke(IpcChannels.git.restore, paths) as Promise<
        { ok: true; message?: string } | { ok: false; message: string; code: string }
      >,
    init: () =>
      ipcRenderer.invoke(IpcChannels.git.init) as Promise<
        { ok: true; message?: string } | { ok: false; message: string; code: string }
      >,
    remotes: () =>
      ipcRenderer.invoke(IpcChannels.git.remotes) as Promise<
        { name: string; fetchUrl: string; pushUrl: string }[]
      >,
    addRemote: (payload: { name: string; url: string }) =>
      ipcRenderer.invoke(IpcChannels.git.addRemote, payload) as Promise<
        { ok: true; message?: string } | { ok: false; message: string; code: string }
      >,
    setRemoteUrl: (payload: { name: string; url: string }) =>
      ipcRenderer.invoke(IpcChannels.git.setRemoteUrl, payload) as Promise<
        { ok: true; message?: string } | { ok: false; message: string; code: string }
      >,
    removeRemote: (name: string) =>
      ipcRenderer.invoke(IpcChannels.git.removeRemote, name) as Promise<
        { ok: true; message?: string } | { ok: false; message: string; code: string }
      >,
    log: (limit?: number) =>
      ipcRenderer.invoke(IpcChannels.git.log, limit) as Promise<{
        entries: {
          hash: string;
          shortHash: string;
          author: string;
          date: string;
          subject: string;
        }[];
      }>,
    conflictContent: (relativePath: string) =>
      ipcRenderer.invoke(IpcChannels.git.conflictContent, relativePath) as Promise<
        GitConflictContentResult
      >,
    resolveConflict: (payload: { relativePath: string; content: string }) =>
      ipcRenderer.invoke(IpcChannels.git.resolveConflict, payload) as Promise<GitOpResult>,
    checkoutConflictSide: (payload: { relativePath: string; side: "ours" | "theirs" }) =>
      ipcRenderer.invoke(
        IpcChannels.git.checkoutConflictSide,
        payload,
      ) as Promise<GitOpResult>,
    abortMerge: () =>
      ipcRenderer.invoke(IpcChannels.git.abortMerge) as Promise<GitOpResult>,
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
    reportTab: (info: {
      tabId: string;
      webContentsId: number;
      url: string;
      title: string;
      visible: boolean;
      workspaceRoot: string | null;
    }) => ipcRenderer.invoke(IpcChannels.browser.reportTab, info) as Promise<{ ok: boolean }>,
    unreportTab: (tabId: string) =>
      ipcRenderer.invoke(IpcChannels.browser.unreportTab, tabId) as Promise<{ ok: boolean }>,
    openTabAck: (payload: { requestId: string; tabId?: string; error?: string }) =>
      ipcRenderer.invoke(IpcChannels.browser.openTabAck, payload) as Promise<{ ok: boolean }>,
    openExternal: (url: string) =>
      ipcRenderer.invoke(IpcChannels.browser.openExternal, url) as Promise<void>,
    onOpenTab: (
      callback: (payload: { requestId: string; url: string | null }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { requestId: string; url: string | null },
      ) => callback(payload);
      ipcRenderer.on(IpcChannels.browser.openTab, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.browser.openTab, listener);
      };
    },
    onCloseTab: (callback: (payload: { tabId: string }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { tabId: string },
      ) => callback(payload);
      ipcRenderer.on(IpcChannels.browser.closeTab, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.browser.closeTab, listener);
      };
    },
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
    onElementScreenshot: (callback: (dataUrl: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, dataUrl: string) => {
        if (typeof dataUrl === "string" && dataUrl.startsWith("data:")) callback(dataUrl);
      };
      ipcRenderer.on(IpcChannels.browser.elementScreenshot, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.browser.elementScreenshot, listener);
      };
    },
    onSelectCancelled: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on(IpcChannels.browser.selectCancelled, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.browser.selectCancelled, listener);
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
  asr: {
    status: () => ipcRenderer.invoke(IpcChannels.asr.status) as Promise<AsrStatus>,
    setEnabled: (enabled: boolean) =>
      ipcRenderer.invoke(IpcChannels.asr.setEnabled, enabled) as Promise<AsrStatus>,
    setGpuPreference: (preference: string) =>
      ipcRenderer.invoke(IpcChannels.asr.setGpuPreference, preference) as Promise<AsrStatus>,
    install: () => ipcRenderer.invoke(IpcChannels.asr.install) as Promise<AsrStatus>,
    installFromUrl: (url: string) =>
      ipcRenderer.invoke(IpcChannels.asr.installFromUrl, url) as Promise<AsrStatus>,
    pickModel: () => ipcRenderer.invoke(IpcChannels.asr.pickModel) as Promise<string | null>,
    importModel: (filePath: string) =>
      ipcRenderer.invoke(IpcChannels.asr.importModel, filePath) as Promise<AsrStatus>,
    reinstallRuntime: () => ipcRenderer.invoke(IpcChannels.asr.reinstallRuntime) as Promise<AsrStatus>,
    pickRuntimeArchive: () =>
      ipcRenderer.invoke(IpcChannels.asr.pickRuntimeArchive) as Promise<string | null>,
    importRuntime: (filePath: string) =>
      ipcRenderer.invoke(IpcChannels.asr.importRuntime, filePath) as Promise<AsrStatus>,
    uninstall: () => ipcRenderer.invoke(IpcChannels.asr.uninstall) as Promise<AsrStatus>,
    transcribe: (pcmBase64: string, sampleRate: number) =>
      ipcRenderer.invoke(IpcChannels.asr.transcribe, { pcmBase64, sampleRate }) as Promise<string>,
    streamStart: () => ipcRenderer.invoke(IpcChannels.asr.streamStart) as Promise<AsrStatus>,
    streamPush: (pcmBase64: string) =>
      ipcRenderer.invoke(IpcChannels.asr.streamPush, { pcmBase64 }) as Promise<void>,
    streamStop: () => ipcRenderer.invoke(IpcChannels.asr.streamStop) as Promise<AsrStatus>,
    onStreamEvent: (callback: (event: AsrStreamEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: AsrStreamEvent) =>
        callback(payload);
      ipcRenderer.on(IpcChannels.asr.streamEvent, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.asr.streamEvent, listener);
      };
    },
    onProgress: (callback: (progress: AsrInstallProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: AsrInstallProgress) =>
        callback(progress);
      ipcRenderer.on(IpcChannels.asr.progress, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.asr.progress, listener);
      };
    },
    setWakeHotkey: (accel: string) =>
      ipcRenderer.invoke(IpcChannels.asr.setWakeHotkey, accel) as Promise<AsrStatus>,
    setResidentModel: (enabled: boolean) =>
      ipcRenderer.invoke(IpcChannels.asr.setResidentModel, enabled) as Promise<AsrStatus>,
    setWakeWords: (raw: string) =>
      ipcRenderer.invoke(IpcChannels.asr.setWakeWords, raw) as Promise<AsrStatus>,
    onWake: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on(IpcChannels.asr.wake, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.asr.wake, listener);
      };
    },
  },
  update: {
    getAppInfo: () => ipcRenderer.invoke(IpcChannels.update.getAppInfo) as Promise<AppInfo>,
    openGithub: () => ipcRenderer.invoke(IpcChannels.update.openGithub) as Promise<void>,
    openReleases: () => ipcRenderer.invoke(IpcChannels.update.openReleases) as Promise<void>,
    openAuthorEmail: () => ipcRenderer.invoke(IpcChannels.update.openAuthorEmail) as Promise<void>,
    check: (opts?: { download?: boolean }) =>
      ipcRenderer.invoke(IpcChannels.update.check, opts) as Promise<UpdateCheckResult>,
    download: () =>
      ipcRenderer.invoke(IpcChannels.update.download) as Promise<UpdateCheckResult>,
    onProgress: (callback: (progress: UpdateProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: UpdateProgress) =>
        callback(progress);
      ipcRenderer.on(IpcChannels.update.progress, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.update.progress, listener);
      };
    },
  },
  piCli: {
    status: () => ipcRenderer.invoke(IpcChannels.piCli.status) as Promise<PiCliStatus>,
    shouldPrompt: () =>
      ipcRenderer.invoke(IpcChannels.piCli.shouldPrompt) as Promise<{
        prompt: boolean;
        status: PiCliStatus;
        skipped: boolean;
      }>,
    install: () => ipcRenderer.invoke(IpcChannels.piCli.install) as Promise<PiCliInstallResult>,
    skip: () => ipcRenderer.invoke(IpcChannels.piCli.skip) as Promise<{ skipped: boolean }>,
    openDocs: () => ipcRenderer.invoke(IpcChannels.piCli.openDocs) as Promise<void>,
    openSite: () => ipcRenderer.invoke(IpcChannels.piCli.openSite) as Promise<void>,
    onProgress: (callback: (progress: PiCliInstallProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: PiCliInstallProgress) =>
        callback(progress);
      ipcRenderer.on(IpcChannels.piCli.progress, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.piCli.progress, listener);
      };
    },
  },
  market: {
    list: (opts?: { query?: string; type?: PiPackageType; page?: number }) =>
      ipcRenderer.invoke(IpcChannels.market.list, opts) as Promise<PiPackageListResult>,
    install: (packageName: string) =>
      ipcRenderer.invoke(IpcChannels.market.install, packageName) as Promise<PiPackageInstallResult>,
  },
  checkpoint: {
    begin: (sessionId: string, userMessageId: string) =>
      ipcRenderer.invoke(IpcChannels.checkpoint.begin, sessionId, userMessageId) as Promise<{
        sessionId: string;
        userMessageId: string;
        status: "capturing" | "ready" | "reverted" | "empty";
        fileCount: number;
        skippedCount: number;
      }>,
    finish: (sessionId: string, userMessageId: string) =>
      ipcRenderer.invoke(IpcChannels.checkpoint.finish, sessionId, userMessageId) as Promise<{
        sessionId: string;
        userMessageId: string;
        status: "capturing" | "ready" | "reverted" | "empty";
        fileCount: number;
        skippedCount: number;
      }>,
    finishActive: (sessionId: string) =>
      ipcRenderer.invoke(IpcChannels.checkpoint.finishActive, sessionId) as Promise<{
        sessionId: string;
        userMessageId: string;
        status: "capturing" | "ready" | "reverted" | "empty";
        fileCount: number;
        skippedCount: number;
      } | null>,
    get: (sessionId: string, userMessageId: string) =>
      ipcRenderer.invoke(IpcChannels.checkpoint.get, sessionId, userMessageId) as Promise<{
        sessionId: string;
        userMessageId: string;
        status: "capturing" | "ready" | "reverted" | "empty";
        fileCount: number;
        skippedCount: number;
      } | null>,
    revert: (sessionId: string, userMessageId: string) =>
      ipcRenderer.invoke(IpcChannels.checkpoint.revert, sessionId, userMessageId) as Promise<{
        ok: boolean;
        restored: number;
        deleted: number;
        skipped: number;
        error: string | null;
      }>,
    onUpdated: (
      callback: (summary: {
        sessionId: string;
        userMessageId: string;
        status: "capturing" | "ready" | "reverted" | "empty";
        fileCount: number;
        skippedCount: number;
      }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        summary: {
          sessionId: string;
          userMessageId: string;
          status: "capturing" | "ready" | "reverted" | "empty";
          fileCount: number;
          skippedCount: number;
        },
      ) => callback(summary);
      ipcRenderer.on(IpcChannels.checkpoint.updated, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.checkpoint.updated, listener);
      };
    },
  },
  notify: {
    turnComplete: (payload: { title: string; body: string }) =>
      ipcRenderer.invoke(IpcChannels.notify.turnComplete, payload) as Promise<{
        ok: boolean;
        notified: boolean;
        focused: boolean;
        error?: string;
      }>,
  },
  trust: {
    get: (cwd: string) =>
      ipcRenderer.invoke(IpcChannels.trust.get, cwd) as Promise<TrustState>,
    set: (cwd: string, trusted: boolean) =>
      ipcRenderer.invoke(IpcChannels.trust.set, cwd, trusted) as Promise<void>,
    clear: (cwd: string) =>
      ipcRenderer.invoke(IpcChannels.trust.clear, cwd) as Promise<void>,
    listTrusted: () =>
      ipcRenderer.invoke(IpcChannels.trust.listTrusted) as Promise<string[]>,
  },
  security: {
    get: () =>
      ipcRenderer.invoke(IpcChannels.security.get) as Promise<DesktopSecuritySettings>,
    set: (settings: DesktopSecuritySettings) =>
      ipcRenderer.invoke(IpcChannels.security.set, settings) as Promise<void>,
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
    isAlive: (id: string) =>
      ipcRenderer.invoke(IpcChannels.terminal.isAlive, id) as Promise<boolean>,
    getScrollback: (id: string) =>
      ipcRenderer.invoke(IpcChannels.terminal.getScrollback, id) as Promise<string | null>,
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

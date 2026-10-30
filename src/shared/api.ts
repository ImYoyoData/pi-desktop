import type {
	AgentCommand,
	AgentEvent,
	ElementCitation,
	MenuCommand,
	SessionHistoryMessage,
	SessionHistoryPage,
	SessionHistoryQuery,
	SessionForkResult,
	SessionStatus,
	SessionSummary,
	TerminalShellOption,
} from "./protocol";
import { IpcChannels } from "./protocol";
import type { StateChange } from "./state-sync";
import type { EditContextMenuAction, EditContextMenuPayload } from "./context-menu";
import type { EditMenuLocale } from "./edit-menu-i18n";
import type {
	GitHubImageResult,
	GitHubResponse,
	PullRequestAction,
	PullRequestChoices,
	PullRequestChoiceKind,
	PullRequestCounts,
	PullRequestDetail,
	PullRequestFilters,
	PullRequestListAuthor,
	PullRequestListState,
	PullRequestPage,
	PullRequestPatchResult,
	PullRequestSummary,
} from "./github-types";
import type { AgentRunEvent, AgentRunSnapshot } from "./agent-runs";
import type { BuiltinExtensionItem, BuiltinToolItem, CodemodeSettingsState, CustomizationsSnapshot, CustomizationCreateKind, InstructionsSaveResult, McpAuthEventPayload, McpAuthPromptReply, McpAuthState, McpAuthTarget, McpTestResult, McpTestTarget, SkillSaveResult } from "./customizations";
import type {
	ModelsGetResult,
	ModelsOAuthEventPayload,
	ModelsQuotaResult,
	ModelsOAuthPromptReply,
	ModelsSetPayload,
	ProviderCatalogResult,
} from "./models-settings";
import type { ModelSelection } from "./model-selection";
import type {
	DiscoverModelsResult,
	TestModelConnectionResult,
	TestProviderBaseUrlResult,
} from "./model-discover";
import type { PreviewResult } from "./preview-types";
import type {
	PiCliInstallProgress,
	PiCliInstallResult,
	PiCliStatus,
} from "./pi-cli";
import type {
	PiPackageInstallResult,
	PiPackageListResult,
	PiPackageType,
	PluginUpdateProgress,
	PluginVersionInfo,
} from "./pi-market";
import type { AskUserAskReply, AskUserAskRequest } from "./ask-user";
import type {
	ExtensionUiEvent,
	ExtensionUiReply,
} from "./extension-ui";
import type { PendingUiSnapshotRequest } from "./protocol";
import type {
	GitConflictContentResult,
	GitOpResult,
} from "./git-types";
import type { ProxySettings } from "./proxy";
import type { ThinkingLanguageSettings } from "./thinking-language";
import type { StreamRenderSettings } from "./stream-render";
import type { RetrySettings } from "./retry-settings";
import type { RuntimeSettings } from "./runtime-settings";
import type {
	PermissionAskReply,
	PermissionAskRequest,
	PermissionSettings,
} from "./permissions";
import type { AppUpdateState } from "./update";

export type AppInfo = {
	version: string;
	githubUrl: string;
	releasesUrl: string;
	author: string;
	qq: string;
	email: string;
};

/** 当前运行环境的系统信息（宿主 OS，不是渲染进程）。 */
export type SystemInfo = {
	platform: string;
	arch: string;
	/** Windows/macOS 的系统版本，如 10.0.22621 / 14.5.0。 */
	version: string;
	/** 内核 release，Linux 上用来展示发行版内核对。 */
	release: string;
};

export type {
	AgentCommand,
	AgentEvent,
	ElementCitation,
	SessionHistoryMessage,
	SessionHistoryPage,
	SessionHistoryQuery,
	SessionStatus,
	SessionSummary,
};

/** Vue 响应式对象是 Proxy，结构化克隆会报 “An object could not be cloned.”。 */
function plainArgs<T>(value: T): T {
	if (value === undefined || value === null) return value;
	try {
		return JSON.parse(JSON.stringify(value)) as T;
	} catch {
		return value;
	}
}

export type ApiListener<T extends unknown[] = unknown[]> = (
	event: Electron.IpcRendererEvent,
	...args: T
) => void;

/** 渲染层到主进程的调用通道：Electron 走 ipcRenderer，浏览器预览走 WebSocket 桥。 */
export type ApiIpc = {
	invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
	on: <T extends unknown[]>(channel: string, listener: ApiListener<T>) => void;
	removeListener: <T extends unknown[]>(channel: string, listener: ApiListener<T>) => void;
	send: (channel: string, ...args: unknown[]) => void;
	sendSync: (channel: string, ...args: unknown[]) => unknown;
};

export type ApiWebUtils = {
	getPathForFile: (file: File) => string;
};

export function createApi(
	ipcRenderer: ApiIpc,
	webUtils: ApiWebUtils,
) {
	return {
	clipboard: {
		writeImage: (dataUrl: string) =>
			ipcRenderer.invoke(
				IpcChannels.clipboard.writeImage,
				dataUrl,
			) as Promise<void>,
	},
	proxy: {
		get: () =>
			ipcRenderer.invoke(IpcChannels.proxy.get) as Promise<ProxySettings>,
		set: (settings: ProxySettings) =>
			ipcRenderer.invoke(
				IpcChannels.proxy.set,
				settings,
			) as Promise<ProxySettings>,
	},
	retry: {
		get: () =>
			ipcRenderer.invoke(IpcChannels.retry.get) as Promise<RetrySettings>,
		set: (settings: RetrySettings) =>
			ipcRenderer.invoke(
				IpcChannels.retry.set,
				settings,
			) as Promise<RetrySettings>,
	},
	runtime: {
		get: () =>
			ipcRenderer.invoke(IpcChannels.runtime.get) as Promise<RuntimeSettings>,
		set: (settings: RuntimeSettings) =>
			ipcRenderer.invoke(
				IpcChannels.runtime.set,
				settings,
			) as Promise<RuntimeSettings>,
	},
	permissions: {
		get: () =>
			ipcRenderer.invoke(IpcChannels.permissions.get) as Promise<PermissionSettings>,
		set: (settings: PermissionSettings) =>
			ipcRenderer.invoke(
				IpcChannels.permissions.set,
				settings,
			) as Promise<PermissionSettings>,
	},
	/** 共享状态统一订阅：任何一端改了共享状态，这里都会收到。 */
	state: {
		onChanged: (callback: (change: StateChange) => void) => {
			const listener = (_event: unknown, change: StateChange) =>
				callback(change);
			ipcRenderer.on(IpcChannels.state.changed, listener);
			return () => {
				ipcRenderer.removeListener(IpcChannels.state.changed, listener);
			};
		},
	},
	window: {
		platform: () =>
			ipcRenderer.invoke(IpcChannels.window.platform) as Promise<NodeJS.Platform>,
		systemInfo: () =>
			ipcRenderer.invoke(IpcChannels.window.systemInfo) as Promise<SystemInfo>,
		minimize: () =>
			ipcRenderer.invoke(IpcChannels.window.minimize) as Promise<void>,
		maximize: () =>
			ipcRenderer.invoke(IpcChannels.window.maximize) as Promise<void>,
		close: () => ipcRenderer.invoke(IpcChannels.window.close) as Promise<void>,
		forceClose: () =>
			ipcRenderer.invoke(IpcChannels.window.forceClose) as Promise<void>,
		isMaximized: () =>
			ipcRenderer.invoke(IpcChannels.window.isMaximized) as Promise<boolean>,
		setThemeSource: (source: "system" | "light" | "dark") =>
			ipcRenderer.invoke(
				IpcChannels.window.setThemeSource,
				source,
			) as Promise<void>,
		setChromeTheme: (mode: "light" | "dark") =>
			ipcRenderer.invoke(IpcChannels.window.setChromeTheme, mode) as Promise<void>,
		setUiLocale: (locale: EditMenuLocale) =>
			ipcRenderer.invoke(IpcChannels.window.setUiLocale, locale) as Promise<void>,
		requestMediaAccess: (kind: "microphone" | "camera") =>
			ipcRenderer.invoke(
				IpcChannels.window.requestMediaAccess,
				kind,
			) as Promise<boolean>,
		openDevTools: () =>
			ipcRenderer.invoke(IpcChannels.window.openDevTools) as Promise<void>,
		onContextMenu: (callback: (payload: EditContextMenuPayload) => void) => {
			const listener = (_event: unknown, payload: EditContextMenuPayload) =>
				callback(payload);
			ipcRenderer.on(IpcChannels.window.contextMenu, listener);
			return () => {
				ipcRenderer.removeListener(IpcChannels.window.contextMenu, listener);
			};
		},
		runContextMenuAction: (action: EditContextMenuAction) =>
			ipcRenderer.invoke(
				IpcChannels.window.contextMenuAction,
				action,
			) as Promise<void>,
		onMenuCommand: (callback: (command: MenuCommand) => void) => {
			const listener = (_event: unknown, command: MenuCommand) =>
				callback(command);
			ipcRenderer.on(IpcChannels.window.menuCommand, listener);
			return () => {
				ipcRenderer.removeListener(IpcChannels.window.menuCommand, listener);
			};
		},
		onCloseRequest: (callback: () => void) => {
			const listener = () => callback();
			ipcRenderer.on(IpcChannels.window.closeRequest, listener);
			return () => {
				ipcRenderer.removeListener(IpcChannels.window.closeRequest, listener);
			};
		},
		onMaximized: (callback: () => void) => {
			const listener = () => callback();
			ipcRenderer.on(IpcChannels.window.onMaximized, listener);
			return () => {
				ipcRenderer.removeListener(IpcChannels.window.onMaximized, listener);
			};
		},
		onUnmaximized: (callback: () => void) => {
			const listener = () => callback();
			ipcRenderer.on(IpcChannels.window.onUnmaximized, listener);
			return () => {
				ipcRenderer.removeListener(IpcChannels.window.onUnmaximized, listener);
			};
		},
	},
	workspace: {
		get: () =>
			ipcRenderer.invoke(IpcChannels.workspace.get) as Promise<string | null>,
		open: () =>
			ipcRenderer.invoke(IpcChannels.workspace.open) as Promise<string | null>,
		pick: () =>
			ipcRenderer.invoke(IpcChannels.workspace.pick) as Promise<string | null>,
		listRecent: () =>
			ipcRenderer.invoke(IpcChannels.workspace.listRecent) as Promise<string[]>,
		listRecentDesktop: () =>
			ipcRenderer.invoke(IpcChannels.workspace.listRecentDesktop) as Promise<
				string[]
			>,
		openPath: (root: string) =>
			ipcRenderer.invoke(IpcChannels.workspace.openPath, root) as Promise<
				string | null
			>,
		clear: () => ipcRenderer.invoke(IpcChannels.workspace.clear) as Promise<null>,
		removeRecent: (root: string) =>
			ipcRenderer.invoke(IpcChannels.workspace.removeRecent, root) as Promise<{
				root: string | null;
				recent: string[];
			}>,
		purge: (root: string) =>
			ipcRenderer.invoke(IpcChannels.workspace.purge, root) as Promise<{
				root: string | null;
				recent: string[];
			}>,
		reorderRecent: (order: string[]) =>
			ipcRenderer.invoke(IpcChannels.workspace.reorderRecent, order) as Promise<
				string[]
			>,
		listAliases: () =>
			ipcRenderer.invoke(IpcChannels.workspace.listAliases) as Promise<
				Record<string, string>
			>,
		setAlias: (root: string, name: string | null) =>
			ipcRenderer.invoke(IpcChannels.workspace.setAlias, root, name) as Promise<
				Record<string, string>
			>,
		relocate: (root: string, next: string) =>
			ipcRenderer.invoke(IpcChannels.workspace.relocate, root, next) as Promise<{
				root: string | null;
				recent: string[];
				aliases: Record<string, string>;
			}>,
		/** 已归档会话 id 列表：读取与覆写（恢复会话即从列表移除该 id）。 */
		listArchivedSessions: () =>
			ipcRenderer.invoke(
				IpcChannels.workspace.listArchivedSessions,
			) as Promise<string[]>,
		setArchivedSessions: (ids: string[]) =>
			ipcRenderer.invoke(
				IpcChannels.workspace.setArchivedSessions,
				ids,
			) as Promise<string[]>,
		revealInFolder: (root: string) =>
			ipcRenderer.invoke(
				IpcChannels.workspace.revealInFolder,
				root,
			) as Promise<void>,
	},
	sessions: {
		list: (cwd: string) =>
			ipcRenderer.invoke(IpcChannels.sessions.list, cwd) as Promise<
				SessionSummary[]
			>,
		create: (cwd: string) =>
			ipcRenderer.invoke(
				IpcChannels.sessions.create,
				cwd,
			) as Promise<SessionSummary>,
		open: (sessionId: string, cwd: string, filePath?: string) =>
			ipcRenderer.invoke(
				IpcChannels.sessions.open,
				sessionId,
				cwd,
				filePath,
			) as Promise<SessionSummary | null>,
		close: (sessionId: string) =>
			ipcRenderer.invoke(IpcChannels.sessions.close, sessionId) as Promise<void>,
		command: (sessionId: string, command: AgentCommand) =>
			ipcRenderer.invoke(
				IpcChannels.sessions.command,
				sessionId,
				command,
			) as Promise<unknown>,
		tryCommand: (sessionId: string, command: AgentCommand) =>
			ipcRenderer.invoke(
				IpcChannels.sessions.tryCommand,
				sessionId,
				command,
			) as Promise<unknown | undefined>,
		killWorker: (sessionId: string) =>
			ipcRenderer.invoke(
				IpcChannels.sessions.killWorker,
				sessionId,
			) as Promise<void>,
		restartWorker: (sessionId: string) =>
			ipcRenderer.invoke(
				IpcChannels.sessions.restartWorker,
				sessionId,
			) as Promise<void>,
		delete: (sessionId: string, cwd: string) =>
			ipcRenderer.invoke(
				IpcChannels.sessions.delete,
				sessionId,
				cwd,
			) as Promise<void>,
		rename: (sessionId: string, cwd: string, name: string) =>
			ipcRenderer.invoke(
				IpcChannels.sessions.rename,
				sessionId,
				cwd,
				name,
			) as Promise<SessionSummary | null>,
		history: (filePath: string, query?: SessionHistoryQuery) =>
			ipcRenderer.invoke(
				IpcChannels.sessions.history,
				filePath,
				query,
			) as Promise<SessionHistoryPage>,
		fork: (sessionId: string, cwd: string, userIndex: number, expectText?: string) =>
			ipcRenderer.invoke(
				IpcChannels.sessions.fork,
				sessionId,
				cwd,
				userIndex,
				expectText,
			) as Promise<SessionForkResult>,
		setUserMessageMeta: (sessionId: string, text: string, tags: unknown[]) =>
			ipcRenderer.invoke(
				IpcChannels.sessions.setUserMessageMeta,
				sessionId,
				text,
				tags,
			),
		cacheImage: (sessionId: string, source: { dataUrl?: string; url?: string }) =>
			ipcRenderer.invoke(
				IpcChannels.sessions.cacheImage,
				sessionId,
				source,
			) as Promise<{ filePath: string; mimeType: string; dataUrl: string }>,
		deleteCachedImage: (sessionId: string, cachePath: string) =>
			ipcRenderer.invoke(
				IpcChannels.sessions.deleteCachedImage,
				sessionId,
				cachePath,
			),
		clearContext: (sessionId: string, cwd: string) =>
			ipcRenderer.invoke(
				IpcChannels.sessions.clearContext,
				sessionId,
				cwd,
			) as Promise<void>,
		status: (sessionId: string, cwd: string) =>
			ipcRenderer.invoke(
				IpcChannels.sessions.status,
				sessionId,
				cwd,
			) as Promise<SessionStatus | null>,
		onEvent: (callback: (event: AgentEvent) => void) => {
			const listener = (_event: Electron.IpcRendererEvent, payload: AgentEvent) =>
				callback(payload);
			ipcRenderer.on(IpcChannels.sessions.event, listener);
			return () => {
				ipcRenderer.removeListener(IpcChannels.sessions.event, listener);
			};
		},
		
		onAskUser: (callback: (payload: AskUserAskRequest) => void) => {
			const listener = (
				_event: Electron.IpcRendererEvent,
				payload: AskUserAskRequest,
			) => callback(payload);
			ipcRenderer.on(IpcChannels.sessions.askUser, listener);
			return () => {
				ipcRenderer.removeListener(IpcChannels.sessions.askUser, listener);
			};
		},
		askUserReply: (payload: AskUserAskReply) =>
			ipcRenderer.invoke(IpcChannels.sessions.askUserReply, payload) as Promise<{
				ok: boolean;
				reason?: string;
			}>,
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
			ipcRenderer.invoke(IpcChannels.permissions.reply, payload) as Promise<{
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
			ipcRenderer.invoke(
				IpcChannels.sessions.extensionUiReply,
				payload,
			) as Promise<{
				ok: boolean;
				reason?: string;
			}>,
		pendingUi: () =>
			ipcRenderer.invoke(
				IpcChannels.sessions.pendingUi,
			) as Promise<PendingUiSnapshotRequest>,
	},
	runs: {
		list: (workspaceRoot: string) =>
			ipcRenderer.invoke(IpcChannels.runs.list, workspaceRoot) as Promise<
				AgentRunSnapshot[]
			>,
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
		search: (query: string, limit?: number) =>
			ipcRenderer.invoke(IpcChannels.files.search, query, limit) as Promise<
				{ name: string; path: string; kind: "file" | "dir" }[]
			>,
		createFile: (relativeDir: string, name: string) =>
			ipcRenderer.invoke(
				IpcChannels.files.createFile,
				relativeDir,
				name,
			) as Promise<string>,
		createDir: (relativeDir: string, name: string) =>
			ipcRenderer.invoke(
				IpcChannels.files.createDir,
				relativeDir,
				name,
			) as Promise<string>,
		rename: (relativePath: string, newName: string) =>
			ipcRenderer.invoke(
				IpcChannels.files.rename,
				relativePath,
				newName,
			) as Promise<string>,
		move: (relativePath: string, destRelativeDir: string) =>
			ipcRenderer.invoke(
				IpcChannels.files.move,
				relativePath,
				destRelativeDir,
			) as Promise<string>,
		delete: (relativePath: string) =>
			ipcRenderer.invoke(IpcChannels.files.delete, relativePath) as Promise<void>,
		reveal: (relativePath: string) =>
			ipcRenderer.invoke(IpcChannels.files.reveal, relativePath) as Promise<void>,
	},
	fs: {
		watch: (root: string) =>
			ipcRenderer.invoke(IpcChannels.fs.watch, root) as Promise<{
				ok: boolean;
			}>,
		unwatch: () =>
			ipcRenderer.invoke(IpcChannels.fs.unwatch) as Promise<{ ok: boolean }>,
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
				files: {
					relativePath: string;
					status: string;
					code: string;
					ignored?: boolean;
					additions?: number | null;
					deletions?: number | null;
				}[];
				errorCode?: string;
				errorMessage?: string;
			}>,
		syncStatus: () =>
			ipcRenderer.invoke(IpcChannels.git.syncStatus) as Promise<{
				upstream: string | null;
				ahead: number;
				behind: number;
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
				| { ok: true; message?: string }
				| { ok: false; message: string; code: string }
			>,
		createBranch: (branch: string, base?: string) =>
			ipcRenderer.invoke(IpcChannels.git.createBranch, branch, base) as Promise<
				| { ok: true; message?: string }
				| { ok: false; message: string; code: string }
			>,
		merge: (branch: string) =>
			ipcRenderer.invoke(IpcChannels.git.merge, branch) as Promise<
				| { ok: true; message?: string }
				| { ok: false; message: string; code: string }
			>,
		deleteBranch: (branch: string) =>
			ipcRenderer.invoke(IpcChannels.git.deleteBranch, branch) as Promise<
				| { ok: true; message?: string }
				| { ok: false; message: string; code: string }
			>,
		renameBranch: (payload: { branch: string; nextName: string }) =>
			ipcRenderer.invoke(IpcChannels.git.renameBranch, payload) as Promise<
				| { ok: true; message?: string }
				| { ok: false; message: string; code: string }
			>,
		logFile: (relativePath: string, limit?: number) =>
			ipcRenderer.invoke(IpcChannels.git.logFile, relativePath, limit) as Promise<{
				entries: {
					hash: string;
					shortHash: string;
					author: string;
					date: string;
					subject: string;
				}[];
			}>,

		showCommitFiles: (commitHash: string) =>
			ipcRenderer.invoke(IpcChannels.git.showCommitFiles, commitHash) as Promise<{
				files: { status: string; path: string }[];
			}>,
		resetToCommit: (commitHash: string, mode: "soft" | "hard") =>
			ipcRenderer.invoke(
				IpcChannels.git.resetToCommit,
				commitHash,
				mode,
			) as Promise<
				| { ok: true; message?: string }
				| { ok: false; message: string; code?: string }
			>,
		stage: (paths: string[]) =>
			ipcRenderer.invoke(IpcChannels.git.stage, paths) as Promise<
				| { ok: true; message?: string }
				| { ok: false; message: string; code?: string }
			>,
		unstage: (paths: string[]) =>
			ipcRenderer.invoke(IpcChannels.git.unstage, paths) as Promise<
				| { ok: true; message?: string }
				| { ok: false; message: string; code?: string }
			>,
		ignore: (paths: string[]) =>
			ipcRenderer.invoke(IpcChannels.git.ignore, paths) as Promise<string[]>,
		unignore: (path: string) =>
			ipcRenderer.invoke(IpcChannels.git.unignore, path) as Promise<string[]>,
		ignored: () =>
			ipcRenderer.invoke(IpcChannels.git.ignored) as Promise<string[]>,
		fileDiffAtCommit: (payload: { relativePath: string; commitHash: string }) =>
			ipcRenderer.invoke(IpcChannels.git.fileDiffAtCommit, payload) as Promise<{
				supported: boolean;
				patch?: string;
			}>,
		restoreFileToCommit: (payload: {
			relativePath: string;
			commitHash: string;
		}) =>
			ipcRenderer.invoke(IpcChannels.git.restoreFileToCommit, payload) as Promise<
				| { ok: true; message?: string }
				| { ok: false; message: string; code: string }
			>,
		commit: (payload: { message: string; paths: string[] }) =>
			ipcRenderer.invoke(IpcChannels.git.commit, payload) as Promise<
				| { ok: true; message?: string }
				| { ok: false; message: string; code: string }
			>,
		pull: () =>
			ipcRenderer.invoke(IpcChannels.git.pull) as Promise<
				| { ok: true; message?: string }
				| { ok: false; message: string; code: string }
			>,
		push: () =>
			ipcRenderer.invoke(IpcChannels.git.push) as Promise<
				| { ok: true; message?: string }
				| { ok: false; message: string; code: string }
			>,
		fetch: (opts?: string | { remote?: string; timeoutMs?: number }) =>
			ipcRenderer.invoke(IpcChannels.git.fetch, opts) as Promise<
				| { ok: true; message?: string }
				| { ok: false; message: string; code: string }
			>,
		restore: (paths: string[]) =>
			ipcRenderer.invoke(IpcChannels.git.restore, paths) as Promise<
				| { ok: true; message?: string }
				| { ok: false; message: string; code: string }
			>,
		init: () =>
			ipcRenderer.invoke(IpcChannels.git.init) as Promise<
				| { ok: true; message?: string }
				| { ok: false; message: string; code: string }
			>,
		remotes: () =>
			ipcRenderer.invoke(IpcChannels.git.remotes) as Promise<
				{ name: string; fetchUrl: string; pushUrl: string }[]
			>,
		addRemote: (payload: { name: string; url: string }) =>
			ipcRenderer.invoke(IpcChannels.git.addRemote, payload) as Promise<
				| { ok: true; message?: string }
				| { ok: false; message: string; code: string }
			>,
		setRemoteUrl: (payload: { name: string; url: string }) =>
			ipcRenderer.invoke(IpcChannels.git.setRemoteUrl, payload) as Promise<
				| { ok: true; message?: string }
				| { ok: false; message: string; code: string }
			>,
		removeRemote: (name: string) =>
			ipcRenderer.invoke(IpcChannels.git.removeRemote, name) as Promise<
				| { ok: true; message?: string }
				| { ok: false; message: string; code: string }
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
			ipcRenderer.invoke(
				IpcChannels.git.conflictContent,
				relativePath,
			) as Promise<GitConflictContentResult>,
		resolveConflict: (payload: { relativePath: string; content: string }) =>
			ipcRenderer.invoke(
				IpcChannels.git.resolveConflict,
				payload,
			) as Promise<GitOpResult>,
		checkoutConflictSide: (payload: {
			relativePath: string;
			side: "ours" | "theirs";
		}) =>
			ipcRenderer.invoke(
				IpcChannels.git.checkoutConflictSide,
				payload,
			) as Promise<GitOpResult>,
		abortMerge: () =>
			ipcRenderer.invoke(IpcChannels.git.abortMerge) as Promise<GitOpResult>,
	},
	github: {
		pullRequest: (branch: string) =>
			ipcRenderer.invoke(IpcChannels.github.pullRequest, branch) as Promise<
				GitHubResponse<{ pullRequest: PullRequestSummary | null }>
			>,
		pullRequestView: (url: string) =>
			ipcRenderer.invoke(IpcChannels.github.pullRequestView, url) as Promise<
				GitHubResponse<{ pullRequest: PullRequestSummary }>
			>,
		pullRequestList: (payload: {
			state: PullRequestListState;
			author: PullRequestListAuthor;
			cursor?: string;
			filters?: PullRequestFilters;
			requestId?: string;
			fresh?: boolean;
		}) =>
			ipcRenderer.invoke(IpcChannels.github.pullRequestList, plainArgs(payload)) as Promise<
				GitHubResponse<PullRequestPage>
			>,
		pullRequestListCancel: (requestId: string) =>
			ipcRenderer.invoke(IpcChannels.github.pullRequestListCancel, requestId) as Promise<void>,
		pullRequestCounts: (payload: {
			state: PullRequestListState;
			author: PullRequestListAuthor;
			filters?: PullRequestFilters;
			requestId?: string;
			fresh?: boolean;
		}) =>
			ipcRenderer.invoke(IpcChannels.github.pullRequestCounts, plainArgs(payload)) as Promise<
				GitHubResponse<{ counts?: PullRequestCounts }>
			>,
		pullRequestDetail: (payload: { url: string; fresh?: boolean }) =>
			ipcRenderer.invoke(IpcChannels.github.pullRequestDetail, plainArgs(payload)) as Promise<
				GitHubResponse<{ detail: PullRequestDetail }>
			>,
		pullRequestPatch: (payload: { url: string; headSha?: string }) =>
			ipcRenderer.invoke(IpcChannels.github.pullRequestPatch, plainArgs(payload)) as Promise<
				GitHubResponse<PullRequestPatchResult>
			>,
		pullRequestAction: (payload: { url: string; action: PullRequestAction }) =>
			ipcRenderer.invoke(IpcChannels.github.pullRequestAction, plainArgs(payload)) as Promise<
				GitHubResponse<object>
			>,
		pullRequestChoices: (payload: { url: string; kind: PullRequestChoiceKind }) =>
			ipcRenderer.invoke(IpcChannels.github.pullRequestChoices, plainArgs(payload)) as Promise<
				GitHubResponse<PullRequestChoices>
			>,
		repositoryChoices: (payload: { kind: PullRequestChoiceKind }) =>
			ipcRenderer.invoke(IpcChannels.github.repositoryChoices, plainArgs(payload)) as Promise<
				GitHubResponse<PullRequestChoices>
			>,
		image: (url: string) =>
			ipcRenderer.invoke(IpcChannels.github.image, url) as Promise<GitHubImageResult>,
	},
	customizations: {
		list: (cwd?: string, force?: boolean) =>
			ipcRenderer.invoke(
				IpcChannels.customizations.list,
				cwd,
				force,
			) as Promise<CustomizationsSnapshot>,
		create: (kind: CustomizationCreateKind) =>
			ipcRenderer.invoke(IpcChannels.customizations.create, kind) as Promise<{
				filePath: string;
			}>,
		createInstructionsFromDraft: (content: string, scope: "user" | "project", cwd?: string) =>
			ipcRenderer.invoke(
				IpcChannels.customizations.createInstructionsFromDraft,
				content,
				scope,
				cwd,
			) as Promise<InstructionsSaveResult>,
		setMcpEnabled: (name: string, scope: "user" | "project", enabled: boolean, cwd?: string) =>
			ipcRenderer.invoke(
				IpcChannels.customizations.setMcpEnabled,
				name,
				scope,
				enabled,
				cwd,
			) as Promise<void>,
		addMcpServers: (
			scope: "user" | "project",
			servers: Record<string, unknown>,
			cwd?: string,
		) =>
			ipcRenderer.invoke(
				IpcChannels.customizations.addMcpServers,
				scope,
				servers,
				cwd,
			) as Promise<{ filePath: string; names: string[] }>,
		readMcpServer: (name: string, scope: "user" | "project", cwd?: string) =>
			ipcRenderer.invoke(
				IpcChannels.customizations.readMcpServer,
				name,
				scope,
				cwd,
			) as Promise<Record<string, unknown> | null>,
		setBuiltinExtensionEnabled: (name: string, enabled: boolean, cwd?: string) =>
			ipcRenderer.invoke(
				IpcChannels.customizations.setBuiltinExtensionEnabled,
				name,
				enabled,
				cwd,
			) as Promise<BuiltinExtensionItem[]>,
		setToolEnabled: (name: string, enabled: boolean, cwd?: string) =>
			ipcRenderer.invoke(
				IpcChannels.customizations.setToolEnabled,
				name,
				enabled,
				cwd,
			) as Promise<BuiltinToolItem[]>,
		setCodemodeSettings: (
			patch: {
				mode?: "on" | "only";
				inlineBudget?: number | null;
				maxWorkers?: number | null;
			},
			cwd?: string,
		) =>
			ipcRenderer.invoke(
				IpcChannels.customizations.setCodemodeSettings,
				patch,
				cwd,
			) as Promise<CodemodeSettingsState>,
		ensureMcpConfig: (scope: "user" | "project", cwd?: string) =>
			ipcRenderer.invoke(
				IpcChannels.customizations.ensureMcpConfig,
				scope,
				cwd,
			) as Promise<{ filePath: string }>,
		removeMcpServer: (name: string, scope: "user" | "project", cwd?: string) =>
			ipcRenderer.invoke(
				IpcChannels.customizations.removeMcpServer,
				name,
				scope,
				cwd,
			) as Promise<{ filePath: string }>,
		removeItem: (filePath: string, cwd?: string) =>
			ipcRenderer.invoke(
				IpcChannels.customizations.removeItem,
				filePath,
				cwd,
			) as Promise<{ filePath: string }>,
		testMcpServers: (targets: McpTestTarget[]) =>
			ipcRenderer.invoke(
				IpcChannels.customizations.testMcpServers,
				targets,
			) as Promise<McpTestResult[]>,
		onUpdated: (callback: (snapshot: CustomizationsSnapshot) => void) => {
			const listener = (
				_event: Electron.IpcRendererEvent,
				snapshot: CustomizationsSnapshot,
			): void => callback(snapshot);
			ipcRenderer.on(IpcChannels.customizations.updated, listener);
			return () => {
				ipcRenderer.removeListener(IpcChannels.customizations.updated, listener);
			};
		},
		mcpAuthStates: (targets: McpAuthTarget[]) =>
			ipcRenderer.invoke(
				IpcChannels.customizations.mcpAuthStates,
				targets,
			) as Promise<Record<string, McpAuthState>>,
		mcpLogin: (target: McpAuthTarget) =>
			ipcRenderer.invoke(
				IpcChannels.customizations.mcpLogin,
				target,
			) as Promise<void>,
		mcpAuthPrompt: (reply: McpAuthPromptReply) =>
			ipcRenderer.invoke(
				IpcChannels.customizations.mcpAuthPrompt,
				reply,
			) as Promise<void>,
		mcpLoginCancel: () =>
			ipcRenderer.invoke(IpcChannels.customizations.mcpLoginCancel) as Promise<void>,
		mcpLogout: (target: McpAuthTarget) =>
			ipcRenderer.invoke(
				IpcChannels.customizations.mcpLogout,
				target,
			) as Promise<boolean>,
		onMcpAuthEvent: (callback: (payload: McpAuthEventPayload) => void) => {
			const listener = (
				_event: Electron.IpcRendererEvent,
				payload: McpAuthEventPayload,
			): void => callback(payload);
			ipcRenderer.on(IpcChannels.customizations.mcpAuthEvent, listener);
			return () => {
				ipcRenderer.removeListener(IpcChannels.customizations.mcpAuthEvent, listener);
			};
		},
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
		setDisabled: (filePath: string, disableModelInvocation: boolean, cwd?: string) =>
			ipcRenderer.invoke(
				IpcChannels.skills.setDisabled,
				filePath,
				disableModelInvocation,
				cwd,
			) as Promise<void>,
		uninstall: (filePath: string, cwd?: string) =>
			ipcRenderer.invoke(
				IpcChannels.skills.uninstall,
				filePath,
				cwd,
			) as Promise<void>,
		createFromDraft: (content: string, scope: "user" | "project", cwd?: string) =>
			ipcRenderer.invoke(
				IpcChannels.skills.createFromDraft,
				content,
				scope,
				cwd,
			) as Promise<SkillSaveResult>,
		save: (filePath: string, content: string, renameName?: string, cwd?: string) =>
			ipcRenderer.invoke(
				IpcChannels.skills.save,
				filePath,
				content,
				renameName,
				cwd,
			) as Promise<SkillSaveResult>,
		rename: (filePath: string, name: string, cwd?: string) =>
			ipcRenderer.invoke(IpcChannels.skills.rename, filePath, name, cwd) as Promise<{
				filePath: string;
				name: string;
			}>,
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
			ipcRenderer.invoke(
				IpcChannels.plugins.remove,
				source,
				scope,
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
		checkUpdates: (cwd?: string) =>
			ipcRenderer.invoke(
				IpcChannels.plugins.checkUpdates,
				cwd,
			) as Promise<PluginVersionInfo[]>,
		update: (source: string, scope: "global" | "project", cwd?: string) =>
			ipcRenderer.invoke(
				IpcChannels.plugins.update,
				source,
				scope,
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
		onUpdateProgress: (callback: (progress: PluginUpdateProgress) => void) => {
			const listener = (
				_event: Electron.IpcRendererEvent,
				progress: PluginUpdateProgress,
			) => callback(progress);
			ipcRenderer.on(IpcChannels.plugins.updateProgress, listener);
			return () => {
				ipcRenderer.removeListener(IpcChannels.plugins.updateProgress, listener);
			};
		},
	},
	models: {
		get: (payload?: { refreshCatalog?: boolean }) =>
			ipcRenderer.invoke(IpcChannels.models.get, payload) as Promise<ModelsGetResult>,
		set: (payload: ModelsSetPayload) =>
			ipcRenderer.invoke(IpcChannels.models.set, payload) as Promise<void>,
		clearKey: (provider: string) =>
			ipcRenderer.invoke(IpcChannels.models.clearKey, provider) as Promise<void>,
		test: () =>
			ipcRenderer.invoke(IpcChannels.models.test) as Promise<
				ModelsGetResult["available"]
			>,
		discover: (payload: {
			baseUrl: string;
			apiKey?: string;
			api?: string;
			providerId?: string;
		}) =>
			ipcRenderer.invoke(
				IpcChannels.models.discover,
				payload,
			) as Promise<DiscoverModelsResult>,
		testBaseUrl: (payload: {
			baseUrl: string;
			apiKey?: string;
			api?: string;
			providerId?: string;
		}) =>
			ipcRenderer.invoke(
				IpcChannels.models.testBaseUrl,
				payload,
			) as Promise<TestProviderBaseUrlResult>,
		testConnection: (payload: {
			baseUrl: string;
			apiKey?: string;
			api?: string;
			modelId: string;
			providerId?: string;
		}) =>
			ipcRenderer.invoke(
				IpcChannels.models.testConnection,
				payload,
			) as Promise<TestModelConnectionResult>,
		providerCatalog: (providerId: string) =>
			ipcRenderer.invoke(
				IpcChannels.models.providerCatalog,
				providerId,
			) as Promise<ProviderCatalogResult>,
		setSelection: (selection: ModelSelection) =>
			ipcRenderer.invoke(
				IpcChannels.models.setSelection,
				selection,
			) as Promise<void>,
		fetchQuota: (providerId: string) =>
			ipcRenderer.invoke(IpcChannels.models.fetchQuota, providerId) as Promise<ModelsQuotaResult>,
		oauthLogin: (providerId: string) =>
			ipcRenderer.invoke(IpcChannels.models.oauthLogin, providerId) as Promise<void>,
		oauthLogout: (providerId: string) =>
			ipcRenderer.invoke(IpcChannels.models.oauthLogout, providerId) as Promise<void>,
		oauthPrompt: (reply: ModelsOAuthPromptReply) =>
			ipcRenderer.invoke(IpcChannels.models.oauthPrompt, reply) as Promise<void>,
		oauthCancel: () => ipcRenderer.invoke(IpcChannels.models.oauthCancel) as Promise<void>,
		onOauthEvent: (callback: (payload: ModelsOAuthEventPayload) => void) => {
			const listener = (_event: Electron.IpcRendererEvent, payload: ModelsOAuthEventPayload) =>
				callback(payload);
			ipcRenderer.on(IpcChannels.models.oauthEvent, listener);
			return () => {
				ipcRenderer.removeListener(IpcChannels.models.oauthEvent, listener);
			};
		},
	},
	preview: {
		read: (filePath: string) =>
			ipcRenderer.invoke(
				IpcChannels.preview.read,
				filePath,
			) as Promise<PreviewResult>,
		write: (filePath: string, content: string) =>
			ipcRenderer.invoke(
				IpcChannels.preview.write,
				filePath,
				content,
			) as Promise<void>,
		pickFile: () =>
			ipcRenderer.invoke(IpcChannels.preview.pickFile) as Promise<string | null>,
		watch: (filePath: string) =>
			ipcRenderer.invoke(IpcChannels.preview.watch, filePath) as Promise<{ ok: boolean }>,
		unwatch: (filePath: string) =>
			ipcRenderer.invoke(IpcChannels.preview.unwatch, filePath) as Promise<{ ok: boolean }>,
		onChanged: (callback: (payload: { paths: string[] }) => void) => {
			const listener = (_event: Electron.IpcRendererEvent, payload: { paths: string[] }) =>
				callback(payload);
			ipcRenderer.on(IpcChannels.preview.changed, listener);
			return () => {
				ipcRenderer.removeListener(IpcChannels.preview.changed, listener);
			};
		},
	},
	browser: {
		startSelect: (webContentsId: number) =>
			ipcRenderer.invoke(
				IpcChannels.browser.startSelect,
				webContentsId,
			) as Promise<{ ok: true } | { ok: false; reason: "csp" | "missing" }>,
		stopSelect: (webContentsId: number) =>
			ipcRenderer.invoke(
				IpcChannels.browser.stopSelect,
				webContentsId,
			) as Promise<void>,
		openDevTools: (webContentsId: number) =>
			ipcRenderer.invoke(
				IpcChannels.browser.openDevTools,
				webContentsId,
			) as Promise<void>,
		attachDevTools: (
			pageWebContentsId: number,
			devtoolsWebContentsId: number,
			open: boolean,
		) =>
			ipcRenderer.invoke(
				IpcChannels.browser.attachDevTools,
				pageWebContentsId,
				devtoolsWebContentsId,
				open,
			) as Promise<{ ok: boolean; open?: boolean }>,
		registerGuest: (pageWebContentsId: number) =>
			ipcRenderer.invoke(
				IpcChannels.browser.registerGuest,
				pageWebContentsId,
			) as Promise<{
				ok: boolean;
			}>,
		reportTab: (info: {
			tabId: string;
			webContentsId: number;
			url: string;
			title: string;
			visible: boolean;
			workspaceRoot: string | null;
		}) =>
			ipcRenderer.invoke(IpcChannels.browser.reportTab, info) as Promise<{
				ok: boolean;
			}>,
		unreportTab: (tabId: string) =>
			ipcRenderer.invoke(IpcChannels.browser.unreportTab, tabId) as Promise<{
				ok: boolean;
			}>,
		openTabAck: (payload: {
			requestId: string;
			tabId?: string;
			error?: string;
		}) =>
			ipcRenderer.invoke(IpcChannels.browser.openTabAck, payload) as Promise<{
				ok: boolean;
			}>,
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
				if (typeof dataUrl === "string" && dataUrl.startsWith("data:"))
					callback(dataUrl);
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
				ipcRenderer.removeListener(
					IpcChannels.browser.toggleEmbeddedDevTools,
					listener,
				);
			};
		},
	},
	contributors: {
		avatar: (url: string) =>
			ipcRenderer.invoke(IpcChannels.contributors.avatar, url) as Promise<string | null>,
	},
	update: {
		getAppInfo: () =>
			ipcRenderer.invoke(IpcChannels.update.getAppInfo) as Promise<AppInfo>,
		openReleases: () =>
			ipcRenderer.invoke(IpcChannels.update.openReleases) as Promise<void>,
		openAuthorEmail: () =>
			ipcRenderer.invoke(IpcChannels.update.openAuthorEmail) as Promise<void>,
		getState: () =>
			ipcRenderer.invoke(IpcChannels.update.getState) as Promise<AppUpdateState>,
		check: () =>
			ipcRenderer.invoke(IpcChannels.update.check) as Promise<AppUpdateState>,
		download: () => ipcRenderer.invoke(IpcChannels.update.download) as Promise<void>,
		forceUpdate: () =>
			ipcRenderer.invoke(IpcChannels.update.forceUpdate) as Promise<void>,
		cancel: () => ipcRenderer.invoke(IpcChannels.update.cancel) as Promise<void>,
		install: () => ipcRenderer.invoke(IpcChannels.update.install) as Promise<void>,
		onState: (callback: (state: AppUpdateState) => void) => {
			const listener = (_event: Electron.IpcRendererEvent, state: AppUpdateState) =>
				callback(state);
			ipcRenderer.on(IpcChannels.update.state, listener);
			return () => {
				ipcRenderer.removeListener(IpcChannels.update.state, listener);
			};
		},
		setToastHeight: (height: number) =>
			ipcRenderer.send(IpcChannels.update.toastResize, height),
		dismissToast: () => ipcRenderer.send(IpcChannels.update.toastDismiss),
		showToast: () => ipcRenderer.send(IpcChannels.update.toastShow),
	},
	piCli: {
		status: () =>
			ipcRenderer.invoke(IpcChannels.piCli.status) as Promise<PiCliStatus>,
		sdkVersion: () =>
			ipcRenderer.invoke(IpcChannels.piCli.sdkVersion) as Promise<string | null>,
		shouldPrompt: () =>
			ipcRenderer.invoke(IpcChannels.piCli.shouldPrompt) as Promise<{
				prompt: boolean;
				status: PiCliStatus;
				skipped: boolean;
			}>,
		install: () =>
			ipcRenderer.invoke(IpcChannels.piCli.install) as Promise<PiCliInstallResult>,
		skip: () =>
			ipcRenderer.invoke(IpcChannels.piCli.skip) as Promise<{
				skipped: boolean;
			}>,
		openDocs: () =>
			ipcRenderer.invoke(IpcChannels.piCli.openDocs) as Promise<void>,
		openSite: () =>
			ipcRenderer.invoke(IpcChannels.piCli.openSite) as Promise<void>,
		onProgress: (callback: (progress: PiCliInstallProgress) => void) => {
			const listener = (
				_event: Electron.IpcRendererEvent,
				progress: PiCliInstallProgress,
			) => callback(progress);
			ipcRenderer.on(IpcChannels.piCli.progress, listener);
			return () => {
				ipcRenderer.removeListener(IpcChannels.piCli.progress, listener);
			};
		},
	},
	market: {
		list: (opts?: { query?: string; type?: PiPackageType; page?: number }) =>
			ipcRenderer.invoke(
				IpcChannels.market.list,
				opts,
			) as Promise<PiPackageListResult>,
		install: (packageName: string) =>
			ipcRenderer.invoke(
				IpcChannels.market.install,
				packageName,
			) as Promise<PiPackageInstallResult>,
	},
	checkpoint: {
		begin: (sessionId: string, userMessageId: string) =>
			ipcRenderer.invoke(
				IpcChannels.checkpoint.begin,
				sessionId,
				userMessageId,
			) as Promise<{
				sessionId: string;
				userMessageId: string;
				status: "capturing" | "ready" | "reverted" | "empty";
				fileCount: number;
				skippedCount: number;
			}>,
		finish: (sessionId: string, userMessageId: string) =>
			ipcRenderer.invoke(
				IpcChannels.checkpoint.finish,
				sessionId,
				userMessageId,
			) as Promise<{
				sessionId: string;
				userMessageId: string;
				status: "capturing" | "ready" | "reverted" | "empty";
				fileCount: number;
				skippedCount: number;
			}>,
		finishActive: (sessionId: string) =>
			ipcRenderer.invoke(
				IpcChannels.checkpoint.finishActive,
				sessionId,
			) as Promise<{
				sessionId: string;
				userMessageId: string;
				status: "capturing" | "ready" | "reverted" | "empty";
				fileCount: number;
				skippedCount: number;
			} | null>,
		get: (sessionId: string, userMessageId: string) =>
			ipcRenderer.invoke(
				IpcChannels.checkpoint.get,
				sessionId,
				userMessageId,
			) as Promise<{
				sessionId: string;
				userMessageId: string;
				status: "capturing" | "ready" | "reverted" | "empty";
				fileCount: number;
				skippedCount: number;
			} | null>,
		list: (sessionId: string) =>
			ipcRenderer.invoke(IpcChannels.checkpoint.list, sessionId) as Promise<
				{
					sessionId: string;
					userMessageId: string;
					status: "capturing" | "ready" | "reverted" | "empty";
					fileCount: number;
					skippedCount: number;
				}[]
			>,
		revert: (sessionId: string, userMessageId: string) =>
			ipcRenderer.invoke(
				IpcChannels.checkpoint.revert,
				sessionId,
				userMessageId,
			) as Promise<{
				ok: boolean;
				restored: number;
				deleted: number;
				skipped: number;
				error: string | null;
			}>,
		netSessionChanges: (
			sessionId: string,
			relativePaths: string[],
		) =>
			ipcRenderer.invoke(
				IpcChannels.checkpoint.netSessionChanges,
				sessionId,
				relativePaths,
			) as Promise<
				Record<
					string,
					{ additions: number; deletions: number; available: boolean }
				>
			>,
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
	startupTiming: {
		mark: (name: string, detail?: string) =>
			ipcRenderer.invoke(IpcChannels.startupTiming.mark, {
				name,
				atEpochMs: Date.now(),
				detail,
			}) as Promise<void>,
	},
	notify: {
		turnComplete: (payload: { title: string; body: string; sessionId?: string }) =>
			ipcRenderer.invoke(IpcChannels.notify.turnComplete, payload) as Promise<{
				ok: boolean;
				notified: boolean;
				focused: boolean;
				error?: string;
			}>,
		onOpenSession: (callback: (payload: { sessionId: string; cwd?: string }) => void) => {
			const listener = (
				_event: Electron.IpcRendererEvent,
				payload: { sessionId: string; cwd?: string },
			) => callback(payload);
			ipcRenderer.on(IpcChannels.notify.openSession, listener);
			return () => {
				ipcRenderer.removeListener(IpcChannels.notify.openSession, listener);
			};
		},
	},
	thinkingLanguage: {
		get: () =>
			ipcRenderer.invoke(
				IpcChannels.thinkingLanguage.get,
			) as Promise<ThinkingLanguageSettings>,
		set: (settings: ThinkingLanguageSettings) =>
			ipcRenderer.invoke(
				IpcChannels.thinkingLanguage.set,
				settings,
			) as Promise<ThinkingLanguageSettings>,
	},
	streamRender: {
		get: () =>
			ipcRenderer.invoke(
				IpcChannels.streamRender.get,
			) as Promise<StreamRenderSettings>,
		set: (settings: StreamRenderSettings) =>
			ipcRenderer.invoke(
				IpcChannels.streamRender.set,
				settings,
			) as Promise<StreamRenderSettings>,
	},
	appearance: {
		pickWallpaper: () =>
			ipcRenderer.invoke(IpcChannels.appearance.pickWallpaper) as Promise<
				string | null
			>,
		pickFontFile: () =>
			ipcRenderer.invoke(IpcChannels.appearance.pickFontFile) as Promise<
				string | null
			>,
	},
	prefs: {
		readSync: () =>
			ipcRenderer.sendSync(IpcChannels.prefs.readSync) as Record<string, string>,
		setSync: (patch: Record<string, string>) =>
			ipcRenderer.sendSync(IpcChannels.prefs.setSync, patch) as void,
		removeSync: (keys: string[]) =>
			ipcRenderer.sendSync(IpcChannels.prefs.removeSync, keys) as void,
		get: () =>
			ipcRenderer.invoke(IpcChannels.prefs.get) as Promise<Record<string, string>>,
		set: (patch: Record<string, string>) =>
			ipcRenderer.invoke(IpcChannels.prefs.set, patch) as Promise<
				Record<string, string>
			>,
		remove: (keys: string[]) =>
			ipcRenderer.invoke(IpcChannels.prefs.remove, keys) as Promise<
				Record<string, string>
			>,
	},
	terminal: {
		create: (cwd?: string, shellId?: string) =>
			ipcRenderer.invoke(
				IpcChannels.terminal.create,
				cwd,
				shellId,
			) as Promise<string>,
		listShells: () =>
			ipcRenderer.invoke(IpcChannels.terminal.listShells) as Promise<
				TerminalShellOption[]
			>,
		write: (id: string, data: string) =>
			ipcRenderer.invoke(IpcChannels.terminal.write, id, data) as Promise<void>,
		resize: (id: string, cols: number, rows: number) =>
			ipcRenderer.invoke(
				IpcChannels.terminal.resize,
				id,
				cols,
				rows,
			) as Promise<void>,
		dispose: (id: string) =>
			ipcRenderer.invoke(IpcChannels.terminal.dispose, id) as Promise<void>,
		isAlive: (id: string) =>
			ipcRenderer.invoke(IpcChannels.terminal.isAlive, id) as Promise<boolean>,
		getScrollback: (id: string) =>
			ipcRenderer.invoke(IpcChannels.terminal.getScrollback, id) as Promise<
				string | null
			>,
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
}

export type PiDesktopApi = ReturnType<typeof createApi>;

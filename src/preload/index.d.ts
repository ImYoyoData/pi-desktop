import type {
	AgentCommand,
	AgentEvent,
	ElementCitation,
	LanConsoleStatus,
	SessionHistoryMessage,
	SessionHistoryPage,
	SessionHistoryQuery,
	SessionInfoResult,
	SessionStatus,
	SessionSummary,
	TerminalShellOption,
} from "../shared/protocol";
import type { AgentRunEvent, AgentRunSnapshot } from "../shared/agent-runs";
import type { EditContextMenuAction, EditContextMenuPayload } from "../shared/context-menu";
import type { AgentSaveResult, CustomizationsSnapshot, CustomizationCreateKind, InstructionsSaveResult, McpTestResult, McpTestTarget, SkillSaveResult } from "../shared/customizations";
import type {
	ModelsGetResult,
	ModelsOAuthEventPayload,
	ModelsOAuthPromptReply,
	ModelsSetPayload,
	ProviderCatalogResult,
} from "../shared/models-settings";
import type { ModelSelection } from "../shared/model-selection";
import type {
	DiscoverModelsResult,
	TestModelConnectionResult,
	TestProviderBaseUrlResult,
} from "../shared/model-discover";
import type { PreviewResult } from "../shared/preview-types";
import type {
	AsrInstallProgress,
	AsrStatus,
	AsrStreamEvent,
} from "../shared/asr";
import type {
	TtsInstallProgress,
	TtsSpeakResult,
	TtsStatus,
} from "../shared/tts";
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
	PluginUpdateProgress,
	PluginVersionInfo,
} from "../shared/pi-market";
import type {
	DesktopSecuritySettings,
	PermissionAskReply,
	PermissionAskRequest,
} from "../shared/desktop-security";
import type { AskUserAskReply, AskUserAskRequest } from "../shared/ask-user";
import type {
	ExtensionUiEvent,
	ExtensionUiReply,
} from "../shared/extension-ui";
import type { PendingUiSnapshotRequest } from "../shared/protocol";
import type {
	GitConflictContentResult,
	GitOpResult,
} from "../shared/git-types";
import type { ProxySettings } from "../shared/proxy";
import type { ThinkingLanguageSettings } from "../shared/thinking-language";
import type { StreamRenderSettings } from "../shared/stream-render";
export type AppInfo = {
	version: string;
	githubUrl: string;
	releasesUrl: string;
	author: string;
	qq: string;
	email: string;
};
export type { UpdateProgress };
export type {
	AgentCommand,
	AgentEvent,
	CloudflareTunnelStatus,
	ElementCitation,
	LanConsoleStatus,
	SessionHistoryMessage,
	SessionHistoryPage,
	SessionHistoryQuery,
	SessionInfoResult,
	SessionStatus,
	SessionSummary,
};
declare const api: {
	clipboard: {
		writeImage: (dataUrl: string) => Promise<void>;
	};
	lanConsole: {
		getStatus: () => Promise<LanConsoleStatus>;
		setEnabled: (enabled: boolean) => Promise<LanConsoleStatus>;
		setPublicAccess: (enabled: boolean) => Promise<LanConsoleStatus>;
		setPort: (port: number) => Promise<LanConsoleStatus>;
		rotatePin: () => Promise<LanConsoleStatus>;
		setTunnelConfig: (
			token: string,
			publicUrl: string,
		) => Promise<LanConsoleStatus>;
		setPreferredIp: (ip: string) => Promise<LanConsoleStatus>;
		onTunnelStatus: (
			callback: (status: CloudflareTunnelStatus) => void,
		) => () => void;
	};
	proxy: {
		get: () => Promise<ProxySettings>;
		set: (settings: ProxySettings) => Promise<ProxySettings>;
		onChanged: (callback: (settings: ProxySettings) => void) => () => void;
	};
	window: {
		platform: () => Promise<NodeJS.Platform>;
		minimize: () => Promise<void>;
		maximize: () => Promise<void>;
		close: () => Promise<void>;
		forceClose: () => Promise<void>;
		isMaximized: () => Promise<boolean>;
		setThemeSource: (source: "system" | "light" | "dark") => Promise<void>;
		setChromeTheme: (mode: "light" | "dark") => Promise<void>;
		setUiLocale: (locale: "zh-CN" | "en") => Promise<void>;
		requestMediaAccess: (kind: "microphone" | "camera") => Promise<boolean>;
		openDevTools: () => Promise<void>;
		onContextMenu: (
			callback: (payload: EditContextMenuPayload) => void,
		) => () => void;
		runContextMenuAction: (action: EditContextMenuAction) => Promise<void>;
		onCloseRequest: (callback: () => void) => () => void;
		onMaximized: (callback: () => void) => () => void;
		onUnmaximized: (callback: () => void) => () => void;
	};
	workspace: {
		get: () => Promise<string | null>;
		open: () => Promise<string | null>;
		pick: () => Promise<string | null>;
		listRecent: () => Promise<string[]>;
		/** Fast path: Desktop recent only (no Pi CLI scan). */
		listRecentDesktop: () => Promise<string[]>;
		openPath: (root: string) => Promise<string | null>;
		clear: () => Promise<null>;
		removeRecent: (root: string) => Promise<{
			root: string | null;
			recent: string[];
		}>;
		/** Forget workspace + purge Pi sessions; never deletes the project folder. */
		purge: (root: string) => Promise<{
			root: string | null;
			recent: string[];
		}>;
		reorderRecent: (order: string[]) => Promise<string[]>;
		revealInFolder: (root: string) => Promise<void>;
		/** 工作区自定义显示名（绝对路径 → 名称）。 */
		listAliases: () => Promise<Record<string, string>>;
		setAlias: (
			root: string,
			name: string | null,
		) => Promise<Record<string, string>>;
		/** 重新定位工作区到新目录，Pi 会话目录随之迁移。 */
		relocate: (
			root: string,
			next: string,
		) => Promise<{
			root: string | null;
			recent: string[];
			aliases: Record<string, string>;
		}>;
		/** 工作区分类（自定义分组）。 */
		listGroups: () => Promise<WorkspaceGroups>;
		addGroup: (name: string) => Promise<WorkspaceGroups>;
		renameGroup: (from: string, to: string) => Promise<WorkspaceGroups>;
		removeGroup: (name: string) => Promise<WorkspaceGroups>;
		setGroupOf: (
			root: string,
			group: string | null,
		) => Promise<WorkspaceGroups>;
		/** 已归档会话 id 列表：读取与覆写（恢复会话即从列表移除该 id）。 */
		listArchivedSessions: () => Promise<string[]>;
		setArchivedSessions: (ids: string[]) => Promise<string[]>;
	};
	sessions: {
		list: (cwd: string) => Promise<SessionSummary[]>;
		create: (cwd: string) => Promise<SessionSummary>;
		open: (sessionId: string, cwd: string) => Promise<SessionSummary | null>;
		close: (sessionId: string) => Promise<void>;
		command: (sessionId: string, command: AgentCommand) => Promise<unknown>;
		tryCommand: (
			sessionId: string,
			command: AgentCommand,
		) => Promise<unknown | undefined>;
		killWorker: (sessionId: string) => Promise<void>;
		restartWorker: (sessionId: string) => Promise<void>;
		delete: (sessionId: string, cwd: string) => Promise<void>;
		rename: (
			sessionId: string,
			cwd: string,
			name: string,
		) => Promise<SessionSummary | null>;
		history: (
			filePath: string,
			query?: SessionHistoryQuery,
		) => Promise<SessionHistoryPage>;
		setUserMessageMeta: (
			sessionId: string,
			text: string,
			tags: unknown[],
		) => Promise<void>;
		cacheImage: (
			sessionId: string,
			source: { dataUrl?: string; url?: string },
		) => Promise<{ filePath: string; mimeType: string; dataUrl: string }>;
		deleteCachedImage: (sessionId: string, cachePath: string) => Promise<void>;
		clearContext: (sessionId: string, cwd: string) => Promise<void>;
		status: (sessionId: string, cwd: string) => Promise<SessionStatus | null>;
		getInfo: (sessionId: string) => Promise<SessionInfoResult>;
		onWorkerReady: (callback: (sessionId: string) => void) => () => void;
		onEvent: (callback: (event: AgentEvent) => void) => () => void;
		onPermission: (
			callback: (payload: PermissionAskRequest) => void,
		) => () => void;
		permissionReply: (payload: PermissionAskReply) => Promise<{
			ok: boolean;
			reason?: string;
		}>;
		onAskUser: (callback: (payload: AskUserAskRequest) => void) => () => void;
		askUserReply: (payload: AskUserAskReply) => Promise<{
			ok: boolean;
			reason?: string;
		}>;
		onExtensionUi: (callback: (payload: ExtensionUiEvent) => void) => () => void;
		extensionUiReply: (payload: ExtensionUiReply) => Promise<{
			ok: boolean;
			reason?: string;
		}>;
		pendingUi: () => Promise<PendingUiSnapshotRequest>;
	};
	runs: {
		list: (workspaceRoot: string) => Promise<AgentRunSnapshot[]>;
		terminate: (runId: string) => Promise<void>;
		background: (runId: string) => Promise<void>;
		onEvent: (
			callback: (event: AgentRunEvent) => void,
		) => () => Electron.IpcRenderer;
	};
	files: {
		/** Electron 32+ removed File.path in renderer; resolve via preload webUtils. */
		getPathForFile: (file: File) => string;
		list: (relativePath?: string) => Promise<
			{
				name: string;
				path: string;
				kind: "file" | "dir";
			}[]
		>;
		search: (
			query: string,
			limit?: number,
		) => Promise<
			{
				name: string;
				path: string;
				kind: "file" | "dir";
			}[]
		>;
		createFile: (relativeDir: string, name: string) => Promise<string>;
		createDir: (relativeDir: string, name: string) => Promise<string>;
		rename: (relativePath: string, newName: string) => Promise<string>;
		move: (relativePath: string, destRelativeDir: string) => Promise<string>;
		delete: (relativePath: string) => Promise<void>;
		reveal: (relativePath: string) => Promise<void>;
	};
	fs: {
		watch: (root: string) => Promise<{
			ok: boolean;
		}>;
		unwatch: () => Promise<{
			ok: boolean;
		}>;
		onChanged: (
			callback: (payload: {
				root: string;
				events: {
					path: string;
					kind: "add" | "change" | "unlink";
				}[];
			}) => void,
		) => () => void;
	};
	git: {
		status: () => Promise<{
			isGitRepository: boolean;
			branch: string | null;
			files: {
				relativePath: string;
				status: string;
				code: string;
			}[];
			errorCode?: string;
			errorMessage?: string;
		}>;
		diff: (relativePath: string) => Promise<{
			supported: boolean;
			status?: string;
			patch?: string;
			oldContent?: string | null;
			newContent?: string | null;
		}>;
		branches: () => Promise<{
			current: string | null;
			local: string[];
			remote: string[];
		}>;
		checkout: (branch: string) => Promise<
			| {
					ok: true;
					message?: string;
			  }
			| {
					ok: false;
					message: string;
					code: string;
			  }
		>;
		createBranch: (
			branch: string,
			base?: string,
		) => Promise<
			| {
					ok: true;
					message?: string;
			  }
			| {
					ok: false;
					message: string;
					code: string;
			  }
		>;
		merge: (branch: string) => Promise<
			| {
					ok: true;
					message?: string;
			  }
			| {
					ok: false;
					message: string;
					code: string;
			  }
		>;
		deleteBranch: (branch: string) => Promise<
			| {
					ok: true;
					message?: string;
			  }
			| {
					ok: false;
					message: string;
					code: string;
			  }
		>;
		renameBranch: (payload: { branch: string; nextName: string }) => Promise<
			| {
					ok: true;
					message?: string;
			  }
			| {
					ok: false;
					message: string;
					code: string;
			  }
		>;
		logFile: (
			relativePath: string,
			limit?: number,
		) => Promise<{
			entries: {
				hash: string;
				shortHash: string;
				author: string;
				date: string;
				subject: string;
			}[];
		}>;

		showCommitFiles: (
			commitHash: string,
		) => Promise<{ files: { status: string; path: string }[] }>;
		resetToCommit: (
			commitHash: string,
			mode: "soft" | "hard",
		) => Promise<
			| {
					ok: true;
					message?: string;
			  }
			| {
					ok: false;
					message: string;
					code?: string;
			  }
		>;
		stage: (
			paths: string[],
		) => Promise<
			| {
					ok: true;
					message?: string;
			  }
			| {
					ok: false;
					message: string;
					code?: string;
			  }
		>;
		unstage: (
			paths: string[],
		) => Promise<
			| {
					ok: true;
					message?: string;
			  }
			| {
					ok: false;
					message: string;
					code?: string;
			  }
		>;
		ignore: (paths: string[]) => Promise<string[]>;
		unignore: (path: string) => Promise<string[]>;
		ignored: () => Promise<string[]>;
		fileDiffAtCommit: (payload: {
			relativePath: string;
			commitHash: string;
		}) => Promise<{
			supported: boolean;
			patch?: string;
		}>;
		restoreFileToCommit: (payload: {
			relativePath: string;
			commitHash: string;
		}) => Promise<
			| {
					ok: true;
					message?: string;
			  }
			| {
					ok: false;
					message: string;
					code: string;
			  }
		>;
		commit: (payload: { message: string; paths: string[] }) => Promise<
			| {
					ok: true;
					message?: string;
			  }
			| {
					ok: false;
					message: string;
					code: string;
			  }
		>;
		pull: () => Promise<
			| {
					ok: true;
					message?: string;
			  }
			| {
					ok: false;
					message: string;
					code: string;
			  }
		>;
		push: () => Promise<
			| {
					ok: true;
					message?: string;
			  }
			| {
					ok: false;
					message: string;
					code: string;
			  }
		>;
		fetch: (remote?: string) => Promise<
			| {
					ok: true;
					message?: string;
			  }
			| {
					ok: false;
					message: string;
					code: string;
			  }
		>;
		restore: (paths: string[]) => Promise<
			| {
					ok: true;
					message?: string;
			  }
			| {
					ok: false;
					message: string;
					code: string;
			  }
		>;
		init: () => Promise<
			| {
					ok: true;
					message?: string;
			  }
			| {
					ok: false;
					message: string;
					code: string;
			  }
		>;
		remotes: () => Promise<
			{
				name: string;
				fetchUrl: string;
				pushUrl: string;
			}[]
		>;
		addRemote: (payload: { name: string; url: string }) => Promise<
			| {
					ok: true;
					message?: string;
			  }
			| {
					ok: false;
					message: string;
					code: string;
			  }
		>;
		setRemoteUrl: (payload: { name: string; url: string }) => Promise<
			| {
					ok: true;
					message?: string;
			  }
			| {
					ok: false;
					message: string;
					code: string;
			  }
		>;
		removeRemote: (name: string) => Promise<
			| {
					ok: true;
					message?: string;
			  }
			| {
					ok: false;
					message: string;
					code: string;
			  }
		>;
		log: (limit?: number) => Promise<{
			entries: {
				hash: string;
				shortHash: string;
				author: string;
				date: string;
				subject: string;
			}[];
		}>;
		conflictContent: (relativePath: string) => Promise<GitConflictContentResult>;
		resolveConflict: (payload: {
			relativePath: string;
			content: string;
		}) => Promise<GitOpResult>;
		checkoutConflictSide: (payload: {
			relativePath: string;
			side: "ours" | "theirs";
		}) => Promise<GitOpResult>;
		abortMerge: () => Promise<GitOpResult>;
	};
	customizations: {
		list: (cwd?: string, force?: boolean) => Promise<CustomizationsSnapshot>;
		create: (kind: CustomizationCreateKind) => Promise<{ filePath: string }>;
		createAgentFromDraft: (
			content: string,
			scope: "user" | "project",
			cwd?: string,
		) => Promise<AgentSaveResult>;
		saveAgent: (
			filePath: string,
			content: string,
			renameName?: string,
			cwd?: string,
		) => Promise<AgentSaveResult>;
		createInstructionsFromDraft: (
			content: string,
			scope: "user" | "project",
			cwd?: string,
		) => Promise<InstructionsSaveResult>;
		setMcpEnabled: (
			name: string,
			scope: "user" | "project",
			enabled: boolean,
			cwd?: string,
		) => Promise<void>;
		addMcpServers: (
			scope: "user" | "project",
			servers: Record<string, unknown>,
			cwd?: string,
		) => Promise<{ filePath: string; names: string[] }>;
		ensureMcpConfig: (
			scope: "user" | "project",
			cwd?: string,
		) => Promise<{ filePath: string }>;
		removeMcpServer: (
			name: string,
			scope: "user" | "project",
			cwd?: string,
		) => Promise<{ filePath: string }>;
		setItemEnabled: (
			filePath: string,
			enabled: boolean,
			cwd?: string,
		) => Promise<{ filePath: string }>;
		removeItem: (filePath: string, cwd?: string) => Promise<{ filePath: string }>;
		testMcpServers: (targets: McpTestTarget[]) => Promise<McpTestResult[]>;
		onUpdated: (callback: (snapshot: CustomizationsSnapshot) => void) => () => void;
	};
	skills: {
		list: (cwd?: string) => Promise<{
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
		}>;
		setDisabled: (
			filePath: string,
			disableModelInvocation: boolean,
			cwd?: string,
		) => Promise<void>;
		uninstall: (filePath: string, cwd?: string) => Promise<void>;
		createFromDraft: (
			content: string,
			scope: "user" | "project",
			cwd?: string,
		) => Promise<SkillSaveResult>;
		save: (
			filePath: string,
			content: string,
			renameName?: string,
			cwd?: string,
		) => Promise<SkillSaveResult>;
		rename: (
			filePath: string,
			name: string,
			cwd?: string,
		) => Promise<{ filePath: string; name: string }>;
	};
	plugins: {
		list: (cwd?: string) => Promise<{
			packages: {
				source: string;
				scope: "global" | "project";
				disabled: boolean;
				installedPath?: string;
				status: "loaded" | "installed" | "missing" | "disabled";
			}[];
		}>;
		setEnabled: (
			source: string,
			scope: "global" | "project",
			enabled: boolean,
			cwd?: string,
		) => Promise<{
			packages: {
				source: string;
				scope: "global" | "project";
				disabled: boolean;
				installedPath?: string;
				status: "loaded" | "installed" | "missing" | "disabled";
			}[];
		}>;
		remove: (
			source: string,
			scope: "global" | "project",
			cwd?: string,
		) => Promise<{
			packages: {
				source: string;
				scope: "global" | "project";
				disabled: boolean;
				installedPath?: string;
				status: "loaded" | "installed" | "missing" | "disabled";
			}[];
		}>;
		checkUpdates: (cwd?: string) => Promise<PluginVersionInfo[]>;
		onUpdateProgress: (
			callback: (progress: PluginUpdateProgress) => void,
		) => () => void;
		update: (
			source: string,
			scope: "global" | "project",
			cwd?: string,
		) => Promise<{
			packages: {
				source: string;
				scope: "global" | "project";
				disabled: boolean;
				installedPath?: string;
				status: "loaded" | "installed" | "missing" | "disabled";
			}[];
		}>;
	};
	models: {
		get: () => Promise<ModelsGetResult>;
		set: (payload: ModelsSetPayload) => Promise<void>;
		clearKey: (provider: string) => Promise<void>;
		test: () => Promise<ModelsGetResult["available"]>;
		discover: (payload: {
			baseUrl: string;
			apiKey?: string;
			api?: string;
		}) => Promise<DiscoverModelsResult>;
		testBaseUrl: (payload: {
			baseUrl: string;
			apiKey?: string;
			api?: string;
		}) => Promise<TestProviderBaseUrlResult>;
		testConnection: (payload: {
			baseUrl: string;
			apiKey?: string;
			api?: string;
			modelId: string;
			providerId?: string;
		}) => Promise<TestModelConnectionResult>;
		providerCatalog: (providerId: string) => Promise<ProviderCatalogResult>;
		setSelection: (selection: ModelSelection) => Promise<void>;
		oauthLogin: (providerId: string) => Promise<void>;
		oauthLogout: (providerId: string) => Promise<void>;
		oauthPrompt: (reply: ModelsOAuthPromptReply) => Promise<void>;
		oauthCancel: () => Promise<void>;
		onOauthEvent: (callback: (payload: ModelsOAuthEventPayload) => void) => () => void;
	};
	preview: {
		read: (filePath: string) => Promise<PreviewResult>;
		write: (filePath: string, content: string) => Promise<void>;
		pickFile: () => Promise<string | null>;
		watch: (filePath: string) => Promise<{ ok: boolean }>;
		unwatch: (filePath: string) => Promise<{ ok: boolean }>;
		onChanged: (callback: (payload: { paths: string[] }) => void) => () => void;
	};
	browser: {
		startSelect: (webContentsId: number) => Promise<
			| {
					ok: true;
			  }
			| {
					ok: false;
					reason: "csp" | "missing";
			  }
		>;
		stopSelect: (webContentsId: number) => Promise<void>;
		openDevTools: (webContentsId: number) => Promise<void>;
		attachDevTools: (
			pageWebContentsId: number,
			devtoolsWebContentsId: number,
			open: boolean,
		) => Promise<{
			ok: boolean;
			open?: boolean;
		}>;
		registerGuest: (pageWebContentsId: number) => Promise<{
			ok: boolean;
		}>;
		reportTab: (info: {
			tabId: string;
			webContentsId: number;
			url: string;
			title: string;
			visible: boolean;
			workspaceRoot: string | null;
		}) => Promise<{
			ok: boolean;
		}>;
		unreportTab: (tabId: string) => Promise<{
			ok: boolean;
		}>;
		openTabAck: (payload: {
			requestId: string;
			tabId?: string;
			error?: string;
		}) => Promise<{
			ok: boolean;
		}>;
		openExternal: (url: string) => Promise<void>;
		onOpenTab: (
			callback: (payload: { requestId: string; url: string | null }) => void,
		) => () => void;
		onCloseTab: (callback: (payload: { tabId: string }) => void) => () => void;
		onElementSelected: (
			callback: (citation: ElementCitation) => void,
		) => () => void;
		onElementScreenshot: (callback: (dataUrl: string) => void) => () => void;
		onSelectCancelled: (callback: () => void) => () => void;
		onToggleEmbeddedDevTools: (callback: () => void) => () => void;
	};
	asr: {
		status: () => Promise<AsrStatus>;
		setEnabled: (enabled: boolean) => Promise<AsrStatus>;
		setGpuPreference: (preference: string) => Promise<AsrStatus>;
		setDownloadMirror: (mirror: string) => Promise<AsrStatus>;
		install: () => Promise<AsrStatus>;
		installFromUrl: (url: string) => Promise<AsrStatus>;
		pickModel: () => Promise<string | null>;
		importModel: (filePath: string) => Promise<AsrStatus>;
		reinstallRuntime: () => Promise<AsrStatus>;
		pickRuntimeArchive: () => Promise<string | null>;
		importRuntime: (filePath: string) => Promise<AsrStatus>;
		cancelInstall: () => Promise<{
			ok: boolean;
		}>;
		uninstall: () => Promise<AsrStatus>;
		transcribe: (pcm: Int16Array, sampleRate: number) => Promise<string>;
		streamStart: () => Promise<AsrStatus>;
		streamPush: (pcm: Int16Array) => Promise<void>;
		streamStop: () => Promise<AsrStatus>;
		onStreamEvent: (callback: (event: AsrStreamEvent) => void) => () => void;
		onProgress: (callback: (progress: AsrInstallProgress) => void) => () => void;
		setWakeHotkey: (accel: string) => Promise<AsrStatus>;
		setResidentModel: (enabled: boolean) => Promise<AsrStatus>;
		setWakeEnabled: (enabled: boolean) => Promise<AsrStatus>;
		setWakeWords: (raw: string) => Promise<AsrStatus>;
		setBackend: (backend: string) => Promise<AsrStatus>;
		getCloudConfig: () => Promise<{
			backend: "local" | "cloud" | null;
			cloud: AsrCloudConfig | null;
		}>;
		setCloudConfig: (cloud: AsrCloudConfig) => Promise<AsrStatus>;
		testCloud: () => Promise<{ ok: boolean; message: string }>;
		onWake: (callback: () => void) => () => void;
	};
	tts: {
		status: () => Promise<TtsStatus>;
		setEnabled: (enabled: boolean) => Promise<TtsStatus>;
		install: () => Promise<TtsStatus>;
		uninstall: () => Promise<TtsStatus>;
		speak: (text: string) => Promise<TtsSpeakResult>;
		stop: () => Promise<TtsStatus>;
		onProgress: (callback: (progress: TtsInstallProgress) => void) => () => void;
		onSpeaking: (
			callback: (payload: { speaking: boolean }) => void,
		) => () => void;
	};
	update: {
		getAppInfo: () => Promise<AppInfo>;
		openGithub: () => Promise<void>;
		openReleases: () => Promise<void>;
		openAuthorEmail: () => Promise<void>;
		check: (opts?: { download?: boolean }) => Promise<UpdateCheckResult>;
		download: () => Promise<UpdateCheckResult>;
		onProgress: (callback: (progress: UpdateProgress) => void) => () => void;
	};
	piCli: {
		status: () => Promise<PiCliStatus>;
		shouldPrompt: () => Promise<{
			prompt: boolean;
			status: PiCliStatus;
			skipped: boolean;
		}>;
		install: () => Promise<PiCliInstallResult>;
		skip: () => Promise<{
			skipped: boolean;
		}>;
		openDocs: () => Promise<void>;
		openSite: () => Promise<void>;
		onProgress: (
			callback: (progress: PiCliInstallProgress) => void,
		) => () => void;
	};
	market: {
		list: (opts?: {
			query?: string;
			type?: PiPackageType;
			page?: number;
		}) => Promise<PiPackageListResult>;
		install: (packageName: string) => Promise<PiPackageInstallResult>;
	};
	checkpoint: {
		begin: (
			sessionId: string,
			userMessageId: string,
		) => Promise<{
			sessionId: string;
			userMessageId: string;
			status: "capturing" | "ready" | "reverted" | "empty";
			fileCount: number;
			skippedCount: number;
		}>;
		finish: (
			sessionId: string,
			userMessageId: string,
		) => Promise<{
			sessionId: string;
			userMessageId: string;
			status: "capturing" | "ready" | "reverted" | "empty";
			fileCount: number;
			skippedCount: number;
		}>;
		finishActive: (sessionId: string) => Promise<{
			sessionId: string;
			userMessageId: string;
			status: "capturing" | "ready" | "reverted" | "empty";
			fileCount: number;
			skippedCount: number;
		} | null>;
		get: (
			sessionId: string,
			userMessageId: string,
		) => Promise<{
			sessionId: string;
			userMessageId: string;
			status: "capturing" | "ready" | "reverted" | "empty";
			fileCount: number;
			skippedCount: number;
		} | null>;
		list: (sessionId: string) => Promise<
			{
				sessionId: string;
				userMessageId: string;
				status: "capturing" | "ready" | "reverted" | "empty";
				fileCount: number;
				skippedCount: number;
			}[]
		>;
		revert: (
			sessionId: string,
			userMessageId: string,
		) => Promise<{
			ok: boolean;
			restored: number;
			deleted: number;
			skipped: number;
			error: string | null;
		}>;
		netSessionChanges: (
			sessionId: string,
			relativePaths: string[],
		) => Promise<
			Record<
				string,
				{ additions: number; deletions: number; available: boolean }
			>
		>;
		onUpdated: (
			callback: (summary: {
				sessionId: string;
				userMessageId: string;
				status: "capturing" | "ready" | "reverted" | "empty";
				fileCount: number;
				skippedCount: number;
			}) => void,
		) => () => void;
	};
	notify: {
		turnComplete: (payload: { title: string; body: string }) => Promise<{
			ok: boolean;
			notified: boolean;
			focused: boolean;
			error?: string;
		}>;
	};
	security: {
		get: () => Promise<DesktopSecuritySettings>;
		set: (settings: DesktopSecuritySettings) => Promise<void>;
	};
	thinkingLanguage: {
		get: () => Promise<ThinkingLanguageSettings>;
		set: (settings: ThinkingLanguageSettings) => Promise<ThinkingLanguageSettings>;
	};
	streamRender: {
		get: () => Promise<StreamRenderSettings>;
		set: (settings: StreamRenderSettings) => Promise<StreamRenderSettings>;
	};
	appearance: {
		pickWallpaper: () => Promise<string | null>;
	};
	terminal: {
		create: (cwd?: string, shellId?: string) => Promise<string>;
		listShells: () => Promise<TerminalShellOption[]>;
		write: (id: string, data: string) => Promise<void>;
		resize: (id: string, cols: number, rows: number) => Promise<void>;
		dispose: (id: string) => Promise<void>;
		isAlive: (id: string) => Promise<boolean>;
		getScrollback: (id: string) => Promise<string | null>;
		onData: (
			callback: (payload: { id: string; data: string }) => void,
		) => () => void;
	};
};
export type PiDesktopApi = typeof api;

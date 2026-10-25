import type { LegacyModeTagKind } from "./injected-blocks";

/** 主进程原生菜单向渲染进程发送的命令。 */
export type MenuCommand =
	| "open-pull-requests"
	| "zoom-in"
	| "zoom-out"
	| "zoom-reset";

export const IpcChannels = {
	window: {
		minimize: "window:minimize",
		maximize: "window:maximize",
		close: "window:close",
		forceClose: "window:forceClose",
		closeRequest: "window:closeRequest",
		isMaximized: "window:isMaximized",
		/** Main → renderer: window just maximized (for title-bar button state). */
		onMaximized: "window:onMaximized",
		/** Main → renderer: window just unmaximized/restored (for title-bar button state). */
		onUnmaximized: "window:onUnmaximized",
		platform: "window:platform",
		setThemeSource: "window:setThemeSource",
		setChromeTheme: "window:setChromeTheme",
		requestMediaAccess: "window:requestMediaAccess",
		setUiLocale: "window:setUiLocale",
		openDevTools: "window:openDevTools",
		/** Main → renderer: 右键编辑菜单（自绘）。 */
		contextMenu: "window:contextMenu",
		/** Renderer → main: 执行右键菜单选中的编辑命令。 */
		contextMenuAction: "window:contextMenuAction",
		/** Main → renderer: 原生菜单命令（打开拉取请求视图等）。 */
		menuCommand: "window:menuCommand",
	},
	clipboard: {
		/** Renderer → main: copy a data-URL image onto the system clipboard. */
		writeImage: "clipboard:writeImage",
	},
	thinkingLanguage: {
		/** Renderer → main: 读取「思考语言」设置。 */
		get: "thinkingLanguage:get",
		/** Renderer → main: 保存「思考语言」设置。 */
		set: "thinkingLanguage:set",
	},
	streamRender: {
		/** Renderer → main: 读取「流式渲染」设置。 */
		get: "streamRender:get",
		/** Renderer → main: 保存「流式渲染」设置（并热重载给活跃 worker）。 */
		set: "streamRender:set",
	},
	retry: {
		/** Renderer → main: 读取「重试」设置。 */
		get: "retry:get",
		/** Renderer → main: 保存「重试」设置（并热重载给活跃 worker）。 */
		set: "retry:set",
	},
	runtime: {
		/** Renderer → main: 读取「运行」设置（压缩 / 缓存 / 隐私）。 */
		get: "runtime:get",
		/** Renderer → main: 保存「运行」设置（并热重载给活跃 worker）。 */
		set: "runtime:set",
	},
	/** 共享状态统一通道：桌面端与浏览器预览页据此同步。 */
	state: {
		/** Main → renderer: 共享状态变化（按范围，见 shared/state-sync.ts）。 */
		changed: "state:changed",
	},
	appearance: {
		/** Renderer → main: 选择壁纸文件（图片/动图/视频）。 */
		pickWallpaper: "appearance:pickWallpaper",
	},
	prefs: {
		/** Renderer → main（同步）: 整份读取桌面端偏好，启动时首帧就要用。 */
		readSync: "prefs:readSync",
		/** Renderer → main（同步）: 退出前补齐未落盘改动。 */
		setSync: "prefs:setSync",
		/** Renderer → main（同步）: 退出前删除键。 */
		removeSync: "prefs:removeSync",
		/** Renderer → main: 整份读取桌面端偏好。 */
		get: "prefs:get",
		/** Renderer → main: 合并写入偏好，返回合并后的整份。 */
		set: "prefs:set",
		/** Renderer → main: 删除偏好键，返回剩余整份。 */
		remove: "prefs:remove",
	},
	workspace: {
		get: "workspace:get",
		open: "workspace:open",
		pick: "workspace:pick",
		openPath: "workspace:openPath",
		clear: "workspace:clear",
		listRecent: "workspace:listRecent",
		/** Instant Desktop-only recent (no Pi CLI session scan). */
		listRecentDesktop: "workspace:listRecentDesktop",
		removeRecent: "workspace:removeRecent",
		/** Forget workspace config + delete Pi sessions (not the project folder). */
		purge: "workspace:purge",
		reorderRecent: "workspace:reorderRecent",
		revealInFolder: "workspace:revealInFolder",
		/** Renderer → main：工作区自定义显示名（路径 → 名称）。 */
		listAliases: "workspace:listAliases",
		/** Renderer → main：设置某工作区显示名（null 清除）。 */
		setAlias: "workspace:setAlias",
		/** 重新定位工作区到新目录，Pi 会话目录随之迁移。 */
		relocate: "workspace:relocate",
		/** 已归档会话 id 列表：读取与覆写。 */
		listArchivedSessions: "workspace:listArchivedSessions",
		setArchivedSessions: "workspace:setArchivedSessions",
	},
	sessions: {
		list: "sessions:list",
		create: "sessions:create",
		open: "sessions:open",
		close: "sessions:close",
		command: "sessions:command",
		tryCommand: "sessions:tryCommand",
		event: "sessions:event",
		status: "sessions:status",
		killWorker: "sessions:killWorker",
		restartWorker: "sessions:restartWorker",
		delete: "sessions:delete",
		history: "sessions:history",
		rename: "sessions:rename",
		/** 把到某一轮 user 消息为止的对话复制成新会话文件。 */
		fork: "sessions:fork",
		/** Clear conversation messages on disk and restart the worker (keeps session id). */
		clearContext: "sessions:clearContext",
		/** Main → renderer: ask_user wizard */
		askUser: "sessions:askUser",
		/** Renderer → main: ask_user answers */
		askUserReply: "sessions:askUserReply",
		/** Main → renderer: Pi extension UI (select/confirm/notify/…) */
		extensionUi: "sessions:extensionUi",
		/** Renderer → main: extension UI dialog reply */
		extensionUiReply: "sessions:extensionUiReply",
		/** Renderer → main: pending interaction prompts still awaiting a reply */
		pendingUi: "sessions:pendingUi",
		/** Renderer → main: persist attachment tags for a sent user message. */
		setUserMessageMeta: "sessions:setUserMessageMeta",
		/** Renderer → main: cache a pasted/URL image into the session attachment folder. */
		cacheImage: "sessions:cacheImage",
		/** Renderer → main: delete one cached image file (removed from the editor). */
		deleteCachedImage: "sessions:deleteCachedImage",
	},
	files: {
		list: "files:list",
		search: "files:search",
		createFile: "files:createFile",
		createDir: "files:createDir",
		rename: "files:rename",
		move: "files:move",
		delete: "files:delete",
		reveal: "files:reveal",
	},
	fs: {
		watch: "fs:watch",
		unwatch: "fs:unwatch",
		changed: "fs:changed",
	},
	git: {
		status: "git:status",
		diff: "git:diff",
		branches: "git:branches",
		checkout: "git:checkout",
		createBranch: "git:createBranch",
		deleteBranch: "git:deleteBranch",
		renameBranch: "git:renameBranch",
		merge: "git:merge",
		commit: "git:commit",
		pull: "git:pull",
		push: "git:push",
		fetch: "git:fetch",
		restore: "git:restore",
		init: "git:init",
		remotes: "git:remotes",
		addRemote: "git:addRemote",
		setRemoteUrl: "git:setRemoteUrl",
		removeRemote: "git:removeRemote",
		log: "git:log",
		logFile: "git:logFile",
		fileDiffAtCommit: "git:fileDiffAtCommit",
		restoreFileToCommit: "git:restoreFileToCommit",
		stage: "git:stage",
		unstage: "git:unstage",
		ignore: "git:ignore",
		ignored: "git:ignored",
		unignore: "git:unignore",
		showCommitFiles: "git:showCommitFiles",
		resetToCommit: "git:resetToCommit",
		conflictContent: "git:conflictContent",
		resolveConflict: "git:resolveConflict",
		checkoutConflictSide: "git:checkoutConflictSide",
		abortMerge: "git:abortMerge",
		syncStatus: "git:syncStatus",
	},
	github: {
		pullRequest: "github:pullRequest",
		pullRequestView: "github:pullRequestView",
		pullRequestList: "github:pullRequestList",
		pullRequestListCancel: "github:pullRequestListCancel",
		pullRequestDetail: "github:pullRequestDetail",
		pullRequestPatch: "github:pullRequestPatch",
		pullRequestAction: "github:pullRequestAction",
		pullRequestChoices: "github:pullRequestChoices",
		repositoryChoices: "github:repositoryChoices",
		image: "github:image",
	},
	customizations: {
		list: "customizations:list",
		create: "customizations:create",
		createInstructionsFromDraft: "customizations:createInstructionsFromDraft",
		setMcpEnabled: "customizations:setMcpEnabled",
		addMcpServers: "customizations:addMcpServers",
		readMcpServer: "customizations:readMcpServer",
		ensureMcpConfig: "customizations:ensureMcpConfig",
		removeMcpServer: "customizations:removeMcpServer",
		setBuiltinExtensionEnabled: "customizations:setBuiltinExtensionEnabled",
		setToolEnabled: "customizations:setToolEnabled",
		setCodemodeSettings: "customizations:setCodemodeSettings",
		removeItem: "customizations:removeItem",
		testMcpServers: "customizations:testMcpServers",
		mcpAuthStates: "customizations:mcpAuthStates",
		mcpLogin: "customizations:mcpLogin",
		mcpAuthPrompt: "customizations:mcpAuthPrompt",
		mcpLoginCancel: "customizations:mcpLoginCancel",
		mcpLogout: "customizations:mcpLogout",
		mcpAuthEvent: "customizations:mcpAuthEvent",
		updated: "customizations:updated",
	},
	skills: {
		list: "skills:list",
		setDisabled: "skills:setDisabled",
		uninstall: "skills:uninstall",
		createFromDraft: "skills:createFromDraft",
		rename: "skills:rename",
		save: "skills:save",
	},
	plugins: {
		list: "plugins:list",
		setEnabled: "plugins:setEnabled",
		remove: "plugins:remove",
		checkUpdates: "plugins:checkUpdates",
		update: "plugins:update",
		updateProgress: "plugins:updateProgress",
	},
	models: {
		get: "models:get",
		set: "models:set",
		clearKey: "models:clearKey",
		test: "models:test",
		discover: "models:discover",
		testBaseUrl: "models:testBaseUrl",
		testConnection: "models:testConnection",
		providerCatalog: "models:providerCatalog",
		setSelection: "models:setSelection",
		fetchQuota: "models:fetchQuota",
		oauthLogin: "models:oauthLogin",
		oauthLogout: "models:oauthLogout",
		oauthPrompt: "models:oauthPrompt",
		oauthCancel: "models:oauthCancel",
		oauthEvent: "models:oauthEvent",
	},
	terminal: {
		create: "terminal:create",
		listShells: "terminal:listShells",
		write: "terminal:write",
		resize: "terminal:resize",
		data: "terminal:data",
		dispose: "terminal:dispose",
		isAlive: "terminal:isAlive",
		getScrollback: "terminal:getScrollback",
	},
	preview: {
		read: "preview:read",
		write: "preview:write",
		pickFile: "preview:pickFile",
		watch: "preview:watch",
		unwatch: "preview:unwatch",
		changed: "preview:changed",
	},
	browser: {
		startSelect: "browser:startSelect",
		stopSelect: "browser:stopSelect",
		elementSelected: "browser:elementSelected",
		elementScreenshot: "browser:elementScreenshot",
		selectCancelled: "browser:selectCancelled",
		openDevTools: "browser:openDevTools",
		attachDevTools: "browser:attachDevTools",
		registerGuest: "browser:registerGuest",
		reportTab: "browser:reportTab",
		unreportTab: "browser:unreportTab",
		openTab: "browser:openTab",
		openTabAck: "browser:openTabAck",
		closeTab: "browser:closeTab",
		openExternal: "browser:openExternal",
		toggleEmbeddedDevTools: "browser:toggleEmbeddedDevTools",
	},
	update: {
		getAppInfo: "update:getAppInfo",
		openGithub: "update:openGithub",
		openReleases: "update:openReleases",
		openAuthorEmail: "update:openAuthorEmail",
		/** Renderer → main: 读取当前更新状态。 */
		getState: "update:getState",
		/** Renderer → main: 检查是否有新版本。 */
		check: "update:check",
		/** Renderer → main: 开始下载新版本。 */
		download: "update:download",
		/** Renderer → main: 忽略版本比较，真实下载并安装最新发布版。 */
		forceUpdate: "update:forceUpdate",
		/** Renderer → main: 取消下载。 */
		cancel: "update:cancel",
		/** Renderer → main: 退出应用并启动安装程序。 */
		install: "update:install",
		/** Main → renderer: 更新状态变化。 */
		state: "update:state",
		/** Renderer → main: 悬浮卡片内容高度变化，窗口跟随调整。 */
		toastResize: "update:toastResize",
		/** Renderer → main: 收起右下角悬浮卡片。 */
		toastDismiss: "update:toastDismiss",
		/** Renderer → main: 重新展开右下角悬浮卡片。 */
		toastShow: "update:toastShow",
	},
	contributors: {
		avatar: "contributors:avatar",
	},
	piCli: {
		status: "piCli:status",
		shouldPrompt: "piCli:shouldPrompt",
		install: "piCli:install",
		skip: "piCli:skip",
		openDocs: "piCli:openDocs",
		openSite: "piCli:openSite",
		progress: "piCli:progress",
	},
	market: {
		list: "market:list",
		install: "market:install",
	},
	startupTiming: {
		mark: "startupTiming:mark",
	},
	checkpoint: {
		begin: "checkpoint:begin",
		finish: "checkpoint:finish",
		finishActive: "checkpoint:finishActive",
		get: "checkpoint:get",
		list: "checkpoint:list",
		revert: "checkpoint:revert",
		netSessionChanges: "checkpoint:netSessionChanges",
		updated: "checkpoint:updated",
	},
	notify: {
		turnComplete: "notify:turnComplete",
		/** Main → renderer: 通知被点击，跳转到对应会话 */
		openSession: "notify:openSession",
	},
	runs: {
		list: "runs:list",
		terminate: "runs:terminate",
		background: "runs:background",
		event: "runs:event",
	},
	proxy: {
		get: "proxy:get",
		set: "proxy:set",
	},
} as const;

/** 内嵌终端可选的 shell，由主进程检测后提供给底栏 "+" 菜单。 */
export type TerminalShellOption = {
	/** terminal.create 传入的标识：Windows 为固定 id，类 Unix 为可执行文件名。 */
	id: string;
	file: string;
	args: string[];
};

export type SessionStatus = "idle" | "running" | "error" | "stuck";

/** Mirrors Pi SDK `ContextUsage` from `AgentSession.getContextUsage()`, plus session stats. */
export type SessionContextUsage = {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
	/** 会话当前模型，用于给结束的轮次标注模型名。 */
	model?: { provider: string; id: string } | null;
	/** 会话当前思考级别（Pi `ThinkingLevel`）。 */
	thinkingLevel?: string | null;
	/** Tool calls across the session (from Pi `getSessionStats`). */
	toolCalls?: number | null;
	/** User + assistant + toolResult messages (from Pi `getSessionStats`). */
	messageCount?: number | null;
	/** User turns (Agent轮数) across the session. */
	turns?: number | null;
	/** Assistant LLM steps (步数) across the session. */
	steps?: number | null;
	/** Total billed input tokens (uncached + cache reads + cache writes). */
	inputTokens?: number | null;
	/** Total billed output tokens. */
	outputTokens?: number | null;
	/** Total billed cache-read tokens (缓存命中). */
	cacheReadTokens?: number | null;
	/** Total billed cache-write tokens. */
	cacheWriteTokens?: number | null;
	/** Total session LLM cost in USD (from Pi `getSessionStats`). */
	costUsd?: number | null;
	/** Total LLM wall time (时长) in ms across the session. */
	llmDurationMs?: number | null;
	/** Average time to first token (首 token) in ms across sampled steps. */
	ttftMs?: number | null;
	/** Number of steps that contributed a TTFT sample. */
	ttftSteps?: number | null;
	/** Average decode throughput (平均 token/s) across sampled steps. */
	tokensPerSecond?: number | null;
	/** Estimated token breakdown for the stacked context bar. */
	segments?: ContextUsageSegment[] | null;
};

export type ContextUsageSegmentId =
	| "system"
	| "tools"
	| "summarized"
	| "conversation"
	| "toolResults";

export type ContextUsageSegment = {
	id: ContextUsageSegmentId;
	tokens: number;
};

/** Pi SDK ImageContent — base64 payload without data: URL prefix. */
export type PromptImageContent = {
	type: "image";
	data: string;
	mimeType: string;
};

export type AgentCommand =
	| {
			type: "prompt";
			message: string;
			images?: PromptImageContent[];
			citations?: ElementCitation[];
	  }
	| { type: "steer"; message: string; images?: PromptImageContent[] }
	| { type: "follow_up"; message: string }
	| { type: "abort" }
	| { type: "clear_queue" }
	| { type: "set_model"; provider: string; modelId: string }
	| { type: "set_thinking_level"; level: string; persist?: boolean }
	| { type: "compact"; customInstructions?: string }
	| { type: "get_state" }
	| { type: "ping" }
	| { type: "hang" }
	/**
	 * Abandon a user turn on the session tree (leaf moves to its parent).
	 * Used when re-editing a published bubble, or to heal after a rejected
	 * image turn that would otherwise poison every subsequent prompt.
	 */
	| { type: "rollback_user"; userIndex?: number; expectText?: string }
	/**
	 * Rewind to the end of a user turn: keep that turn's Q&A and drop every
	 * later turn (leaf moves to the turn's last message).
	 */
	| { type: "rollback_turn_end"; userIndex?: number; expectText?: string };

export type ElementCitation = {
	url: string;
	selector: string;
	text: string;
	htmlSnippet: string;
	/** element click vs drag-to-region screenshot (Cursor-like). */
	kind?: "element" | "region";
	/** data:image/...;base64,... screenshot of selected element bounds (UI only; strip before IPC) */
	screenshotDataUrl?: string;
	/** CSS-pixel bounds in the guest page viewport (UI only; strip before IPC) */
	bounds?: { x: number; y: number; width: number; height: number };
};

/**
 * Image attachment source for the per-session cache: either a base64 data
 * URL (pasted bitmap) or a remote image URL to download.
 */
export type SessionImageCacheSource = { dataUrl: string } | { url: string };

export type SessionImageCacheResult = {
	/** Absolute path inside the session's .attachments folder. */
	filePath: string;
	/** Normalized image mime type. */
	mimeType: string;
	/** data: URL for immediate display / agent payload. */
	dataUrl: string;
};

export function isRegionCitation(
	c: Pick<ElementCitation, "kind" | "selector">,
): boolean {
	return c.kind === "region" || c.selector === "[region]";
}

/** Deep plain clone for Electron IPC (Vue proxies cannot be structured-cloned). */
export function toIpcPlain<T>(value: T): T {
	const json = JSON.stringify(value);
	try {
		return JSON.parse(json) as T;
	} catch {
		// stringify succeeded, so parse cannot realistically fail.
		return value;
	}
}

/** Build Pi ImageContent list from composer/chat image payloads. */
export function toPromptImages(
	images: unknown[] | undefined,
): PromptImageContent[] | undefined {
	if (!images?.length) return undefined;
	const out: PromptImageContent[] = [];
	for (const img of images) {
		if (!img || typeof img !== "object") continue;
		const o = img as { type?: unknown; data?: unknown; mimeType?: unknown };
		let data = typeof o.data === "string" ? o.data : "";
		let mimeType =
			typeof o.mimeType === "string" && o.mimeType.trim()
				? o.mimeType.trim()
				: "image/png";
		if (!data) continue;
		// Accept accidental data-URL form and normalize to raw base64.
		const dataUrl = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/i.exec(
			data.trim(),
		);
		if (dataUrl?.[1] && dataUrl[2]) {
			mimeType = dataUrl[1];
			data = dataUrl[2];
		}
		if (!data) continue;
		out.push({ type: "image", data, mimeType });
	}
	return out.length ? out : undefined;
}

/** Citations for the worker — text context only (screenshots travel as images). */
export function toPromptCitations(
	citations: ElementCitation[] | undefined,
): ElementCitation[] | undefined {
	if (!citations?.length) return undefined;
	return citations.map((c) => ({
		url: String(c.url ?? ""),
		selector: String(c.selector ?? ""),
		text: String(c.text ?? ""),
		htmlSnippet: String(c.htmlSnippet ?? ""),
		...(c.kind === "region" || c.kind === "element" ? { kind: c.kind } : {}),
	}));
}

export type AgentEvent =
	| { type: "connected"; sessionId: string }
	| { type: "agent_event"; sessionId: string; event: Record<string, unknown> }
	| { type: "context_usage"; sessionId: string; usage: SessionContextUsage }
	| { type: "prompt_done"; sessionId: string }
	| { type: "prompt_error"; sessionId: string; errorMessage: string }
	| { type: "worker_stuck"; sessionId: string }
	| { type: "worker_stall"; sessionId: string }
	| { type: "worker_alive"; sessionId: string }
	| { type: "worker_exit"; sessionId: string; code: number | null }
	| { type: "session_status"; sessionId: string; status: SessionStatus }
	/** 会话产生新活动：主进程刷新最近时间，侧栏据此重排。 */
	| { type: "session_activity"; sessionId: string; modified: string };

export type SessionHistoryMessage =
	| {
			id: string;
			role: "user";
			text: string;
			/** Restored image content parts (data URLs) — survives session reloads. */
			images?: { mimeType: string; dataUrl: string }[];
			/** Restored attachment chips (file / url / element) — survives session reloads. */
			elementTags?: {
				url: string;
				host: string;
				label: string;
				content?: string;
				kind?: "file" | "url" | "element" | LegacyModeTagKind;
			}[];
	  }
	| {
			id: string;
			role: "assistant";
			text: string;
			/** Model reasoning / thinking block when present. */
			thinking?: string;
			/** 本轮使用的模型（服务端 responseModel 优先）。 */
			model?: { provider: string; id: string } | null;
			/** 本轮实际生效的思考档位。 */
			thinkingLevel?: string;
			/** Token 用量（恢复历史时从会话文件还原）。 */
			usage?: { input?: number; output?: number; totalTokens?: number } | null;
			/** 本轮耗时毫秒（恢复历史时从时间戳还原）。 */
			durationMs?: number;
	  }
	| {
			id: string;
			role: "tool";
			toolCallId: string;
			toolName: string;
			text: string;
			isError?: boolean;
			/** Tool-call arguments from the preceding assistant toolCall (e.g. write content). */
			args?: unknown;
			/** 工具执行耗时毫秒（pi 1.1.0 起记录在工具结果上）。 */
			durationMs?: number;
			/** 工具内部调用（ctx.executeTool）的摘要，从 pi 的 nestedCalls 还原。 */
			nestedCalls?: {
				toolCallId: string;
				toolName: string;
				/** 调用参数：渲染层据此说明「这个工具干了啥」。 */
				args?: unknown;
				isError?: boolean;
				durationMs?: number;
			}[];
	  }
	| {
			id: string;
			role: "summary";
			text: string;
			/** 上下文压缩摘要 / 分支摘要。 */
			kind: "compaction" | "branch";
			/** 压缩前的 token 数（compaction 才有）。 */
			tokensBefore?: number;
	  };

/** Paginated leaf-path history for the chat UI (avoid loading entire huge sessions). */
export type SessionHistoryPage = {
	messages: SessionHistoryMessage[];
	hasMore: boolean;
	total: number;
};

export type SessionHistoryQuery = {
	limit?: number;
	/** Load messages strictly older than this id (scroll-up). */
	beforeId?: string | null;
};

/** 单页历史条数（往上翻历史时按此粒度取）。主进程 readSessionHistoryPage 的默认值。 */
export const SESSION_HISTORY_PAGE_SIZE = 30;

/**
 * 聊天界面首次打开一个会话时加载的尾部历史条数。
 *
 * 刻意不无上限：超长会话（几千轮）一次性全量载入，会把海量消息与大工具输出
 * 一次性灌进渲染进程堆，是内存崩溃的主要来源。更早的历史按需往上翻。
 */
export const SESSION_HISTORY_INITIAL_LIMIT = 500;

export type SessionSummary = {
	id: string;
	filePath: string;
	cwd: string;
	name?: string;
	modified: string;
	/** 会话文件 header 的创建时间（缺失时回退 modified）。 */
	created?: string;
	firstMessage?: string;
	status: SessionStatus;
	/** 派生会话的父会话 id（由 header.parentSession 路径解析）。 */
	parentSessionId?: string;
};

/** 到某一轮 user 消息为止派生出的新会话。 */
export type SessionForkResult = {
	id: string;
	filePath: string;
	cwd: string;
};

/** Renderer asks main for interaction prompts still awaiting a reply (post-reload recovery). */
export type PendingUiSnapshotRequest = {
	asks: import("./ask-user").AskUserAskPrompt[];
	extensionDialogs: PendingUiExtensionSnapshot[];
};

export type PendingUiExtensionSnapshot = import("./extension-ui").ExtensionUiPending;

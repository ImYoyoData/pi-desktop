import type { WorkerResourceSummary } from "./worker-resources";

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
	},
	clipboard: {
		/** Renderer → main: copy a data-URL image onto the system clipboard. */
		writeImage: "clipboard:writeImage",
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
		listClosed: "workspace:listClosed",
		removeRecent: "workspace:removeRecent",
		/** Forget workspace config + delete Pi sessions (not the project folder). */
		purge: "workspace:purge",
		reorderRecent: "workspace:reorderRecent",
		revealInFolder: "workspace:revealInFolder",
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
		/** Renderer ? main: loaded tools/extensions/skills for a session. */
		getInfo: "sessions:getInfo",
		/** Main ? renderer: a session worker finished loading its resources. */
		workerReady: "sessions:workerReady",
		killWorker: "sessions:killWorker",
		restartWorker: "sessions:restartWorker",
		delete: "sessions:delete",
		history: "sessions:history",
		rename: "sessions:rename",
		/** 把到某一轮 user 消息为止的对话复制成新会话文件。 */
		fork: "sessions:fork",
		/** Clear conversation messages on disk and restart the worker (keeps session id). */
		clearContext: "sessions:clearContext",
		/** Main → renderer: permission strip ask */
		permission: "sessions:permission",
		/** Renderer → main: permission strip reply */
		permissionReply: "sessions:permissionReply",
		/** Main → renderer: ask_user wizard */
		askUser: "sessions:askUser",
		/** Renderer → main: ask_user answers */
		askUserReply: "sessions:askUserReply",
		/** Main → renderer: Pi extension UI (select/confirm/notify/…) */
		extensionUi: "sessions:extensionUi",
		/** Renderer → main: extension UI dialog reply */
		extensionUiReply: "sessions:extensionUiReply",
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
	lanConsole: {
		/** Renderer → main: current remote-control status (enabled / port / pin / urls). */
		getStatus: "lanConsole:getStatus",
		/** Renderer → main: enable or disable LAN (local network) access. */
		setEnabled: "lanConsole:setEnabled",
		/** Renderer → main: enable or disable public access via a Cloudflare tunnel. */
		setPublicAccess: "lanConsole:setPublicAccess",
		/** Renderer → main: change the LAN port. */
		setPort: "lanConsole:setPort",
		/** Renderer → main: issue a new 9-digit access PIN. */
		rotatePin: "lanConsole:rotatePin",
		/** Renderer → main: pick which LAN IPv4 to show in QR / copy URL. */
		setPreferredIp: "lanConsole:setPreferredIp",
		/** Main → renderer: public-access (cloudflared) state changed. */
		tunnelStatus: "lanConsole:tunnelStatus",
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
	skills: {
		list: "skills:list",
		setDisabled: "skills:setDisabled",
		uninstall: "skills:uninstall",
	},
	plugins: {
		list: "plugins:list",
		setEnabled: "plugins:setEnabled",
		remove: "plugins:remove",
	},
	models: {
		get: "models:get",
		set: "models:set",
		clearKey: "models:clearKey",
		test: "models:test",
		discover: "models:discover",
		testConnection: "models:testConnection",
		providerCatalog: "models:providerCatalog",
		setSelection: "models:setSelection",
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
	asr: {
		status: "asr:status",
		setEnabled: "asr:setEnabled",
		setGpuPreference: "asr:setGpuPreference",
		setDownloadMirror: "asr:setDownloadMirror",
		install: "asr:install",
		installFromUrl: "asr:installFromUrl",
		pickModel: "asr:pickModel",
		importModel: "asr:importModel",
		reinstallRuntime: "asr:reinstallRuntime",
		pickRuntimeArchive: "asr:pickRuntimeArchive",
		importRuntime: "asr:importRuntime",
		/** Abort in-flight runtime/model download. */
		cancelInstall: "asr:cancelInstall",
		uninstall: "asr:uninstall",
		transcribe: "asr:transcribe",
		streamStart: "asr:streamStart",
		streamPush: "asr:streamPush",
		streamStop: "asr:streamStop",
		streamEvent: "asr:streamEvent",
		progress: "asr:progress",
		setWakeHotkey: "asr:setWakeHotkey",
		setResidentModel: "asr:setResidentModel",
		setWakeEnabled: "asr:setWakeEnabled",
		setWakeWords: "asr:setWakeWords",
		setBackend: "asr:setBackend",
		getCloudConfig: "asr:getCloudConfig",
		setCloudConfig: "asr:setCloudConfig",
		testCloud: "asr:testCloud",
		/** Main → renderer: global wake hotkey pressed. */
		wake: "asr:wake",
	},
	tts: {
		status: "tts:status",
		setEnabled: "tts:setEnabled",
		install: "tts:install",
		uninstall: "tts:uninstall",
		speak: "tts:speak",
		stop: "tts:stop",
		progress: "tts:progress",
		/** Main → renderer: playback started/stopped. */
		speaking: "tts:speaking",
	},
	update: {
		getAppInfo: "update:getAppInfo",
		openGithub: "update:openGithub",
		openReleases: "update:openReleases",
		openAuthorEmail: "update:openAuthorEmail",
		check: "update:check",
		download: "update:download",
		progress: "update:progress",
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
	},
	runs: {
		list: "runs:list",
		terminate: "runs:terminate",
		background: "runs:background",
		event: "runs:event",
	},
	trust: {
		get: "trust:get",
		set: "trust:set",
		clear: "trust:clear",
		listTrusted: "trust:listTrusted",
	},
	security: {
		get: "security:get",
		set: "security:set",
	},
	proxy: {
		get: "proxy:get",
		set: "proxy:set",
		changed: "proxy:changed",
	},
} as const;

/** 内嵌终端可选的 shell，由主进程检测后提供给底栏 "+" 菜单。 */
export type TerminalShellOption = {
	/** terminal.create 传入的标识：Windows 为固定 id，类 Unix 为可执行文件名。 */
	id: string;
	file: string;
	args: string[];
};

export type TrustPromptKind = "none" | "ask";

export type TrustState = {
	decision: boolean | null;
	needsResources: boolean;
	prompt: TrustPromptKind;
	projectTrusted: boolean;
};

export type SessionStatus = "idle" | "running" | "error" | "stuck";

/** Public-access (Cloudflare quick tunnel) state, mirrored from the main process. */
export type CloudflareTunnelStatus = {
	/** User wants public access; install/start may still be in flight. */
	enabled: boolean;
	/** cloudflared binary present and ready. */
	installed: boolean;
	/** cloudflared process running. */
	running: boolean;
	/** Current step while bringing the tunnel up. */
	phase: "off" | "downloading" | "starting" | "on" | "error";
	/** Public trycloudflare URL once the tunnel is up (changes every start). */
	url: string | null;
	/** Last failure message, shown in the remote-control panel. */
	error: string | null;
	/** Loopback origin the tunnel forwards to. */
	origin: string | null;
	/** Where the cloudflared binary lives. */
	binaryPath: string;
	/** True when the user supplied their own cloudflared build. */
	customBinary: boolean;
};

/**
 * Remote-control (formerly "LAN web console") status exposed to the settings UI.
 *
 * Login is a single 9-digit numeric PIN. The LAN side is plain HTTP (no
 * certificate warnings on phones) while public access rides a Cloudflare tunnel
 * that terminates TLS at the edge.
 */
export type LanConsoleStatus = {
	/** LAN access switch (default on). */
	enabled: boolean;
	/** HTTPS listener is actually accepting connections. */
	listening: boolean;
	/** Public access via Cloudflare tunnel (default off). */
	publicAccess: boolean;
	port: number;
	/** 9-digit access PIN shown in the panel and used to log in. */
	pin: string;
	/** Selected LAN IPv4 used for QR / copy (best-effort ranked when unset). */
	preferredIp: string;
	/** All candidate LAN IPv4s, preferred/best-ranked first. */
	addresses: string[];
	/** HTTPS URLs for each address (same order as `addresses`). */
	urls: string[];
	/** Preferred LAN access URL, e.g. https://192.168.1.5:18700. */
	baseUrl: string;
	/** Full LAN URL for opening the console (PIN login). */
	url: string;
	/** Public tunnel URL when public access is up, else null. */
	publicUrl: string | null;
	/** Cloudflare tunnel detail for the panel. */
	tunnel: CloudflareTunnelStatus;
};

/** Tools / extensions / skills loaded into a session worker (null while booting). */
export type SessionExtensionInfo = {
	path: string;
	/** Readable extension name (package name or file stem). */
	name: string;
	/** Short description from the extension package.json when available. */
	brief: string;
};

export type SessionInfoResult = {
	resources: WorkerResourceSummary | null;
	/** Extension paths enriched with a readable name + brief description. */
	extensions: SessionExtensionInfo[];
};

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
	| { type: "set_model"; provider: string; modelId: string }
	| { type: "set_thinking_level"; level: string }
	| { type: "compact"; customInstructions?: string }
	| { type: "get_state" }
	| { type: "ping" }
	| { type: "hang" }
	/**
	 * Abandon a user turn on the session tree (leaf moves to its parent).
	 * Used when re-editing a published bubble, or to heal after a rejected
	 * image turn that would otherwise poison every subsequent prompt.
	 */
	| { type: "rollback_user"; userIndex?: number; expectText?: string };

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
	| { type: "session_status"; sessionId: string; status: SessionStatus };

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
				kind?: "file" | "url" | "element" | "agent" | "plan" | "ask" | "task";
			}[];
	  }
	| {
			id: string;
			role: "assistant";
			text: string;
			/** Model reasoning / thinking block when present. */
			thinking?: string;
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

/** 聊天界面一次性加载全部尾部历史，分页只用于上滑加载更早的消息。 */
export const SESSION_HISTORY_LOAD_LIMIT = 1_000_000;

export type SessionSummary = {
	id: string;
	filePath: string;
	cwd: string;
	name?: string;
	modified: string;
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

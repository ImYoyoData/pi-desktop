import type { ImageContent } from "@earendil-works/pi-ai/compat";
import { readFileSync, writeFileSync } from "node:fs";
import {
	routedThinkingLevel,
	type ThinkingLevel,
} from "../shared/thinking-level";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	createBashToolDefinition,
	createPowerShellToolDefinition,
	defineTool,
	getAgentDir,
	SessionManager,
	SettingsManager,
	type AgentSession,
	type ExtensionError,
} from "@earendil-works/pi-coding-agent";
import type { AgentCommand, ElementCitation } from "../shared/protocol";
import { toPromptImages } from "../shared/protocol";
import { messageContentText, turnTextMatches } from "../shared/turn-match";
import {
	formatNoVisionModelError,
	isImageSchemaPromptError,
} from "../shared/session-tree";
import { truncateHtmlSnippet } from "../shared/html-snippet";
import type {
	WorkerInbound,
	WorkerOutbound,
} from "../shared/agent-worker-messages";
import {
	ensureSessionFileOnDisk,
	openExistingSessionFile,
} from "./session-file";
import {
	BUILTIN_BROWSER_SELECTION_HEADER,
	isBuiltinBrowserToolName,
	resolveBuiltinBrowserSkillDir,
	shouldEnableBuiltinBrowserTools,
} from "../shared/builtin-browser";
import {
	DEFAULT_DESKTOP_SECURITY,
	isPermissionDecision,
	parseDesktopSecurity,
	PERMISSION_ASK_TIMEOUT_MS,
	type DesktopSecuritySettings,
	type SecurityCategory,
} from "../shared/desktop-security";
import {
	DESKTOP_ASK_USER_PROMPT,
	DESKTOP_COMPOSER_MODES_PROMPT,
	DESKTOP_BASH_BACKGROUND_PROMPT,
	DESKTOP_PROJECT_ORIENTATION_PROMPT,
	DESKTOP_TODO_PROMPT,
} from "../shared/desktop-system-prompt";
import { createAskUserToolDefinition } from "./ask-user-tool";
import { createTodoWriteToolDefinition } from "./todo-tool";
import { commandShouldStartBackground } from "../shared/bash-background";
import { createTrackedBashOperations } from "./bash-run-tracker";
import {
	commandShellPrompt,
	describeCommandShell,
	detectCommandShell,
} from "./command-shell";
import { createBrowserToolDefinitions } from "./browser-tools";
import {
	readContextUsage,
	SessionTimingTracker,
	type SessionTiming,
} from "./context-usage";
import {
	parseSessionTiming,
	sessionTimingPath,
} from "../shared/session-timing";
import { pruneOldToolResults } from "./tool-result-prune";
import { createDesktopExtensionUIContext } from "./extension-ui-context";
import { handleRpcResponse, rpcToMain, setRpcWorkspaceRoot } from "./main-rpc";
import { createPermissionGate } from "./permission-gate";
import {
	logResourceSummary,
	summarizeSessionResources,
} from "./resource-summary";

function post(msg: WorkerOutbound): void {
	process.parentPort?.postMessage(msg);
}

let session: AgentSession | null = null;
let initStarted = false;
let runTracker: ReturnType<typeof createTrackedBashOperations> | null = null;
const timingTracker = new SessionTimingTracker();
let lastPersistedTimingJson = "";

function restoreTimingFromDisk(filePath: string): void {
	timingTracker.reset();
	lastPersistedTimingJson = "";
	try {
		const raw = readFileSync(sessionTimingPath(filePath), "utf8");
		const timing = parseSessionTiming(JSON.parse(raw));
		if (timing) {
			timingTracker.restore(timing);
			lastPersistedTimingJson = JSON.stringify(timing);
		}
	} catch {
		// ignore
	}
}

function persistTimingToDisk(timing: SessionTiming): void {
	const filePath = session?.sessionFile;
	if (!filePath) return;
	try {
		const json = JSON.stringify(timing);
		if (json === lastPersistedTimingJson) return;
		writeFileSync(sessionTimingPath(filePath), json, "utf8");
		lastPersistedTimingJson = json;
	} catch {
		// ignore
	}
}

function timingStats() {
	const timing = timingTracker.snapshot();
	return {
		llmDurationMs: timing.llmMs > 0 ? timing.llmMs : null,
		ttftMs: timing.ttftSteps > 0 ? timing.ttftMs / timing.ttftSteps : null,
		ttftSteps: timing.ttftSteps > 0 ? timing.ttftSteps : null,
		tokensPerSecond:
			timing.decodeMs > 0 ? timing.outputTokens / (timing.decodeMs / 1000) : null,
	};
}
let desktopSecurity: DesktopSecuritySettings = { ...DEFAULT_DESKTOP_SECURITY };
const sessionAllows = new Set<SecurityCategory>();
/** Once unlocked this session, keep browser_* available for follow-up clicks/fills. */
let browserToolsUnlocked = false;

function workerDirname(): string {
	// electron-vite bundles the worker as CJS; __dirname points at out/agent-worker.
	return typeof __dirname === "string" ? __dirname : process.cwd();
}

function syncBuiltinBrowserTools(active: AgentSession, enable: boolean): void {
	const current = active.getActiveToolNames();
	const withoutBrowser = current.filter(
		(name) => !isBuiltinBrowserToolName(name),
	);
	if (!enable) {
		if (withoutBrowser.length !== current.length) {
			active.setActiveToolsByName(withoutBrowser);
		}
		return;
	}
	const browserNames = active
		.getAllTools()
		.map((t) => t.name)
		.filter(isBuiltinBrowserToolName);
	const next = [...new Set([...withoutBrowser, ...browserNames])];
	if (next.length !== current.length || next.some((n) => !current.includes(n))) {
		active.setActiveToolsByName(next);
	}
}

function applyBuiltinBrowserToolGate(
	active: AgentSession,
	message: string,
	citations?: ElementCitation[] | null,
): void {
	if (
		!browserToolsUnlocked &&
		shouldEnableBuiltinBrowserTools(message, citations)
	) {
		browserToolsUnlocked = true;
	}
	syncBuiltinBrowserTools(active, browserToolsUnlocked);
}
function normalizePromptImages(
	images: unknown[] | undefined,
): ImageContent[] | undefined {
	const normalized = toPromptImages(images);
	return normalized as ImageContent[] | undefined;
}

function modelAcceptsImages(active: AgentSession): boolean {
	const input = active.model?.input;
	return Array.isArray(input) && input.includes("image");
}

function messageContentHasImage(content: unknown): boolean {
	if (!Array.isArray(content)) return false;
	return content.some(
		(part) =>
			Boolean(part) &&
			typeof part === "object" &&
			(part as { type?: unknown }).type === "image",
	);
}

/**
 * 当前分支（root → leaf）上的 user 轮次 entry id。
 * 排除早期重新编辑留下的废弃分支，使渲染端统计的轮次下标与这里一致。
 */
function branchUserEntryIds(active: AgentSession): string[] {
	return active.sessionManager
		.getBranch()
		.filter((entry) => entry.type === "message" && entry.message.role === "user")
		.map((entry) => entry.id);
}

/** 分支上某个 user entry 的提示词文本。 */
function userEntryText(active: AgentSession, entryId: string): string {
	const entry = active.sessionManager.getEntry(entryId);
	if (!entry || entry.type !== "message") return "";
	return messageContentText((entry.message as { content?: unknown }).content);
}

/**
 * 放弃某一轮 user 对话（leaf 移到该 entry 的父节点）。
 * `userIndex` 为当前分支上 user 消息的 0 基下标；`expectText` 用于确认该下标
 * 仍指向界面上的那一轮，避免界面与分支不同步时回退到别的轮次。
 */
async function rollbackUserTurn(
	active: AgentSession,
	userIndex?: number,
	expectText?: string,
): Promise<boolean> {
	const entryIds = branchUserEntryIds(active);
	if (!entryIds.length) return false;
	const idx = userIndex == null ? entryIds.length - 1 : userIndex;
	// 越界说明该气泡从未进入 Agent 会话树（例如 prompt 前就被拒绝），
	// 此时不要顺延到更早的一轮。
	if (idx < 0 || idx >= entryIds.length) return false;
	const target = entryIds[idx];
	if (!target) return false;
	if (expectText && !turnTextMatches(userEntryText(active, target), expectText)) {
		return false;
	}
	await active.navigateTree(target, { summarize: false });
	// leaf 位置只由文件末尾隐含表示：不落一条标记，重开会话时被放弃的轮次会重新成为 leaf。
	try {
		active.sessionManager.appendCustomEntry("desktop-turn-rollback", {
			rolledBackEntryId: target,
		});
	} catch {
		// 标记失败不影响回退本身
	}
	return true;
}

/** Abandon the earliest user turn that still carries image parts (heals poisoned history). */
async function rollbackFirstImageUserTurn(
	active: AgentSession,
): Promise<boolean> {
	for (const entryId of branchUserEntryIds(active)) {
		const entry = active.sessionManager.getEntry(entryId);
		if (!entry || entry.type !== "message") continue;
		const content = (entry.message as { content?: unknown }).content;
		if (!messageContentHasImage(content)) continue;
		await active.navigateTree(entryId, { summarize: false });
		return true;
	}
	return false;
}

async function healAfterPromptFailure(
	active: AgentSession,
	hadImages: boolean,
	errorMessage: string,
): Promise<void> {
	try {
		if (hadImages) {
			await rollbackUserTurn(active);
			return;
		}
		if (isImageSchemaPromptError(errorMessage)) {
			await rollbackFirstImageUserTurn(active);
		}
	} catch {
		// best-effort — surface the original prompt error either way
	}
}

function lastAssistantErrorMessage(active: AgentSession): string | null {
	for (let i = active.messages.length - 1; i >= 0; i--) {
		const m = active.messages[i] as {
			role?: string;
			stopReason?: string;
			errorMessage?: string;
		};
		if (m?.role !== "assistant") continue;
		if (
			m.stopReason === "error" &&
			typeof m.errorMessage === "string" &&
			m.errorMessage
		) {
			return m.errorMessage;
		}
		return null;
	}
	return null;
}

/** Strip bulky / non-essential fields so IPC stays reliable and agent_end always reaches UI. */
function sanitizeAgentEvent(
	event: Record<string, unknown>,
): Record<string, unknown> {
	const type = event.type;
	if (type === "agent_end") {
		const messages = Array.isArray(event.messages) ? event.messages : [];
		const last = messages.length > 0 ? messages[messages.length - 1] : undefined;
		let lastError: string | undefined;
		if (last && typeof last === "object") {
			const msg = last as { stopReason?: unknown; errorMessage?: unknown };
			if (msg.stopReason === "error" && typeof msg.errorMessage === "string") {
				lastError = msg.errorMessage;
			}
		}
		return {
			type: "agent_end",
			willRetry: Boolean(event.willRetry),
			...(lastError ? { lastError } : {}),
		};
	}
	if (type === "agent_settled") {
		return { type: "agent_settled" };
	}
	if (type === "turn_end") {
		return { type: "turn_end" };
	}
	return event;
}

/** 实时消息附上本轮实际生效的思考档，供消息底部标注（历史消息由 transcript 还原）。 */
function withEffectiveThinkingLevel(
	event: Record<string, unknown>,
	active: AgentSession,
): Record<string, unknown> {
	if (event.type !== "message_end") return event;
	const message = event.message;
	if (!message || typeof message !== "object") return event;
	const msg = message as Record<string, unknown>;
	if (msg.role !== "assistant") return event;
	return { ...event, message: { ...msg, thinkingLevel: active.thinkingLevel } };
}

const CONTEXT_USAGE_EVENT_TYPES = new Set([
	"agent_end",
	"agent_settled",
	"message_end",
	"compaction_end",
	"turn_end",
	"tool_execution_end",
]);

function busyLoopMs(ms: number): void {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		// intentional busy loop for isolation smoke
	}
}

function formatCitationsBlock(citations: ElementCitation[]): string {
	const body = citations
		.map((c, index) => {
			const shot =
				c.screenshotDataUrl || c.kind === "region"
					? "\n- Screenshot: attached as image"
					: "";
			if (c.kind === "region" || c.selector === "[region]") {
				return `### Citation ${index + 1} (region)\n- URL: ${c.url}\n- Region: ${c.text || "screenshot"}${shot}`;
			}
			return `### Citation ${index + 1}\n- URL: ${c.url}\n- Selector: \`${c.selector}\`\n- Text: ${c.text}${shot}\n\n\`\`\`html\n${truncateHtmlSnippet(c.htmlSnippet)}\n\`\`\``;
		})
		.join("\n\n");
	return `${BUILTIN_BROWSER_SELECTION_HEADER}\n\nContext from browser selection:\n\n${body}\n\n---\n\n`;
}

async function initSession(
	cwd: string,
	filePath: string | undefined,
	projectTrusted: boolean,
	securitySnapshot?: DesktopSecuritySettings,
): Promise<void> {
	if (initStarted) {
		return;
	}
	initStarted = true;
	browserToolsUnlocked = false;
	setRpcWorkspaceRoot(cwd);
	if (securitySnapshot) {
		desktopSecurity = parseDesktopSecurity(securitySnapshot);
	}
	const agentDir = getAgentDir();
	const sessionManager = filePath
		? openExistingSessionFile(SessionManager, filePath, cwd)
		: SessionManager.create(cwd);
	// New sessions must hit disk before idle-destroy / cold reopen (avoids id mismatch).
	ensureSessionFileOnDisk(sessionManager);
	const initialSessionFile = sessionManager.getSessionFile();
	if (initialSessionFile) {
		restoreTimingFromDisk(initialSessionFile);
	}
	const settingsManager = SettingsManager.create(cwd, agentDir, {
		projectTrusted: Boolean(projectTrusted),
	});
	const builtinBrowserSkillDir = resolveBuiltinBrowserSkillDir(
		workerDirname(),
		typeof process.resourcesPath === "string" ? process.resourcesPath : undefined,
	);
	// Which command shell this machine can actually run (see command-shell.ts).
	const commandShell = detectCommandShell();
	const commandShellPromptText = commandShellPrompt(commandShell);
	console.info(`[pi-desktop] command shell: ${describeCommandShell(commandShell)}`);
	const services = await createAgentSessionServices({
		cwd,
		agentDir,
		settingsManager,
		resourceLoaderOptions: {
			appendSystemPrompt: [
				DESKTOP_PROJECT_ORIENTATION_PROMPT,
				DESKTOP_ASK_USER_PROMPT,
				DESKTOP_TODO_PROMPT,
				DESKTOP_BASH_BACKGROUND_PROMPT,
				DESKTOP_COMPOSER_MODES_PROMPT,
				...(commandShellPromptText ? [commandShellPromptText] : []),
			],
			...(builtinBrowserSkillDir
				? { additionalSkillPaths: [builtinBrowserSkillDir] }
				: {}),
		},
	});
	forceDefaultThinkingLevels(services.modelRuntime);
	let assertBashExecAllowed: ((command: string) => void) | null = null;
	let takeBashBackgroundFlag: ((command: string) => boolean) | null = null;
	runTracker = createTrackedBashOperations(undefined, {
		sessionId: sessionManager.getSessionId(),
		workspaceRoot: cwd,
		onStarted: (run) => post({ kind: "run_started", run }),
		onOutput: (runId, chunk) => post({ kind: "run_output", runId, chunk }),
		onEnded: (runId) => post({ kind: "run_ended", runId }),
		onBackgrounded: (runId) => post({ kind: "run_backgrounded", runId }),
		beforeExec: (command) => assertBashExecAllowed?.(command),
		shouldStartBackground: (command) =>
			Boolean(takeBashBackgroundFlag?.(command)) ||
			commandShouldStartBackground(command),
	});
	const { session: created, extensionsResult } =
		await createAgentSessionFromServices({
			services,
			sessionManager,
			// With no usable bash, the SDK's `bash` tool would otherwise be active and
			// every call would fail with "execvpe(/bin/bash) failed". Deny it and let
			// the PowerShell tool take over — the tool registry activates every
			// sibling of the tools that are active, so `powershell` comes on by
			// itself while `ask_user` / `todo_write` stay active too. (An allowlist
			// (`tools`) would drop those custom tools, hence the denylist only.)
			...(commandShell.kind === "powershell" ? { excludeTools: ["bash"] } : {}),
			customTools: [
				// Command tool. On Windows the SDK's own shell fallback picks
				// `where bash.exe`, i.e. the WSL launcher, which fails with
				// "execvpe(/bin/bash) failed" whenever no WSL distro is installed.
				// Hand the bash tool a REAL bash when one exists; otherwise expose
				// the SDK's PowerShell tool instead of a bash that cannot run.
				commandShell.kind === "powershell"
					? defineTool(
							createPowerShellToolDefinition(cwd, {
								operations: runTracker.operations,
							}),
						)
					: defineTool(
							createBashToolDefinition(cwd, {
								operations: runTracker.operations,
								...(commandShell.kind === "bash"
									? { shellPath: commandShell.shellPath }
									: {}),
							}),
						),
				createAskUserToolDefinition(),
				createTodoWriteToolDefinition(),
				...createBrowserToolDefinitions(),
			],
		});
	// Bind Desktop ExtensionUIContext so ctx.ui.select/confirm/notify work in Electron.
	// session_start is when extensions (incl. MCP-backed ones) typically connect.
	const extensionBindErrors: string[] = [];
	try {
		await created.bindExtensions({
			uiContext: createDesktopExtensionUIContext(),
			mode: "rpc",
			onError: (err: ExtensionError) => {
				const message = `${err.extensionPath} @ ${err.event}: ${err.error}`;
				extensionBindErrors.push(message);
				console.error(`[pi-desktop] extension runtime error: ${message}`);
				if (err.stack) console.error(err.stack);
			},
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		extensionBindErrors.push(`bindExtensions failed: ${message}`);
		console.error(`[pi-desktop] bindExtensions failed: ${message}`);
	}
	// Registered but inactive until the user mentions browser / selects elements.
	syncBuiltinBrowserTools(created, false);
	const {
		gate: permissionGate,
		assertBashExecAllowed: assertBash,
		takeBashBackgroundFlag: takeBg,
	} = createPermissionGate({
		getSettings: () => desktopSecurity,
		getCwd: () => cwd,
		sessionAllows,
		askUser: async (req) => {
			const raw = await rpcToMain(
				"desktop.permissionAsk",
				{
					category: req.category,
					toolName: req.toolName,
					summary: req.summary,
				},
				PERMISSION_ASK_TIMEOUT_MS,
			);
			if (!isPermissionDecision(raw)) {
				throw new Error("invalid permission decision from main");
			}
			return raw;
		},
	});
	assertBashExecAllowed = assertBash;
	takeBashBackgroundFlag = takeBg;
	const prevBefore = created.agent.beforeToolCall?.bind(created.agent);
	created.agent.beforeToolCall = async (ctx, signal) => {
		const gated = await permissionGate(ctx, signal);
		if (gated?.block) return gated;
		return prevBefore?.(ctx, signal);
	};

	created.subscribe((event) => {
		const raw = event as Record<string, unknown>;
		timingTracker.observe(event);
		try {
			post({
				kind: "event",
				event: sanitizeAgentEvent(withEffectiveThinkingLevel(raw, created)),
			});
		} catch {
			// Last-resort: always deliver a lightweight lifecycle signal so UI can leave "running".
			const type = typeof raw.type === "string" ? raw.type : "unknown";
			post({ kind: "event", event: { type } });
		}
		const t = raw.type;
		if (typeof t === "string" && CONTEXT_USAGE_EVENT_TYPES.has(t)) {
			try {
				emitContextUsage(created);
			} catch {
				// context meter is best-effort
			}
		}
	});
	session = created;
	const resources = summarizeSessionResources(
		services,
		extensionsResult,
		created.getActiveToolNames(),
		created.getAllTools() as { name: string; description?: string }[],
	);
	if (extensionBindErrors.length) {
		resources.diagnostics.push(
			...extensionBindErrors.map((message) => `[bind] ${message}`),
		);
	}
	logResourceSummary(resources);
	post({
		kind: "ready",
		id: sessionManager.getSessionId(),
		filePath: sessionManager.getSessionFile() ?? "",
		cwd: sessionManager.getCwd(),
		resources,
	});
	setTimeout(() => {
		try {
			if (session) emitContextUsage(session);
		} catch {
			// ignore
		}
	}, 0);
}

function requireSession(): AgentSession {
	if (!session) {
		throw new Error("worker session not initialized");
	}
	return session;
}

/**
 * ModelRuntime.refresh() reloads models.json / catalogs, but AuthStorage keeps an
 * in-memory snapshot of auth.json from worker start. Re-read disk before refresh.
 */
function reloadAuthStorageCache(active: AgentSession): void {
	const runtime = active.modelRuntime as unknown as {
		credentials?: { store?: { reload?: () => void } };
	};
	runtime.credentials?.store?.reload?.();
}

async function refreshSessionModel(active: AgentSession): Promise<void> {
	const current = active.model;
	if (!current) return;
	const next = active.modelRuntime.getModel(current.provider, current.id);
	if (next && next !== current) {
		await setModelPreservingThinking(active, next);
	}
}

/**
 * Pi 切模型会把思考级别重置为默认值；这里保留切换前的实际等级（并套用界面路由），
 * 避免“选 Medium、实际又被重置回默认值”。
 */
async function setModelPreservingThinking(
	active: AgentSession,
	model: SessionModel,
): Promise<void> {
	const level = routedThinkingLevel(active.thinkingLevel);
	await active.setModel(model);
	if (active.thinkingLevel !== level) active.setThinkingLevel(level);
}

type SessionModel = NonNullable<ReturnType<AgentSession["modelRuntime"]["getModel"]>>;

/** Pi 只在 thinkingLevelMap 显式映射时才提供 XHigh/Max；完全未配置时按支持处理。 */
function withDefaultThinkingLevels(model: SessionModel): SessionModel {
	if (!model.reasoning) return model;
	// 用户（或目录）已配置映射就尊重，保留 Pi 的档位回退（如 xhigh 不支持→max）。
	if (model.thinkingLevelMap !== undefined) return model;
	return { ...model, thinkingLevelMap: { xhigh: "xhigh", max: "max" } };
}

/** 在 ModelRuntime 上补默认思考等级，不改写 models.json。 */
function forceDefaultThinkingLevels(runtime: AgentSession["modelRuntime"]): void {
	const getModel = runtime.getModel.bind(runtime);
	const getModels = runtime.getModels.bind(runtime);
	const getAvailable = runtime.getAvailable.bind(runtime);
	const getAvailableSnapshot = runtime.getAvailableSnapshot.bind(runtime);
	runtime.getModel = (providerId, modelId) => {
		const model = getModel(providerId, modelId);
		return model ? withDefaultThinkingLevels(model) : undefined;
	};
	runtime.getModels = (providerId) => getModels(providerId).map(withDefaultThinkingLevels);
	runtime.getAvailable = async (providerId, options) =>
		(await getAvailable(providerId, options)).map(withDefaultThinkingLevels);
	runtime.getAvailableSnapshot = () =>
		getAvailableSnapshot().map(withDefaultThinkingLevels);
}

function emitContextUsage(active: AgentSession): void {
	const usage = readContextUsage(active);
	if (!usage) return;
	const timing = timingTracker.snapshot();
	persistTimingToDisk(timing);
	const model = active.model;
	post({
		kind: "event",
		event: {
			type: "context_usage",
			tokens: usage.tokens,
			contextWindow: usage.contextWindow,
			percent: usage.percent,
			model: model ? { provider: model.provider, id: model.id } : null,
			thinkingLevel: active.thinkingLevel,
			toolCalls: usage.toolCalls,
			messageCount: usage.messageCount,
			turns: usage.turns,
			steps: usage.steps,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			cacheReadTokens: usage.cacheReadTokens,
			cacheWriteTokens: usage.cacheWriteTokens,
			costUsd: usage.costUsd,
			llmDurationMs: timing.llmMs > 0 ? timing.llmMs : null,
			ttftMs: timing.ttftSteps > 0 ? timing.ttftMs / timing.ttftSteps : null,
			ttftSteps: timing.ttftSteps > 0 ? timing.ttftSteps : null,
			tokensPerSecond:
				timing.decodeMs > 0 ? timing.outputTokens / (timing.decodeMs / 1000) : null,
			segments: usage.segments ?? null,
		},
	});
}

/**
 * OpenCode-style prune: shrink old tool results in the live agent message list
 * before the next model turn (or before LLM compact). Disk jsonl is unchanged.
 */
function pruneAgentToolResults(active: AgentSession): void {
	try {
		const result = pruneOldToolResults(
			active.messages as unknown as Parameters<typeof pruneOldToolResults>[0],
		);
		if (result.changed) {
			emitContextUsage(active);
		}
	} catch {
		// prune is best-effort — never block the turn
	}
}

export async function handleWorkerMessage(msg: WorkerInbound): Promise<void> {
	if (msg.kind === "ping") {
		post({ kind: "pong" });
		return;
	}
	if (msg.kind === "shutdown") {
		runTracker?.endAllRuns();
		persistTimingToDisk(timingTracker.snapshot());
		process.exit(0);
		return;
	}
	if (msg.kind === "reload_models") {
		if (session) {
			reloadAuthStorageCache(session);
			await session.modelRuntime.refresh({ allowNetwork: false });
			await refreshSessionModel(session);
		}
		return;
	}
	if (msg.kind === "reload_resources") {
		// 重新加载设置与扩展（含 MCP），让配置变更在现有会话中生效。
		try {
			await session?.reload();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[pi-desktop] reload resources failed: ${message}`);
		}
		return;
	}
	if (msg.kind === "reload_security") {
		desktopSecurity = parseDesktopSecurity(msg.desktopSecurity);
		return;
	}
	if (msg.kind === "init") {
		await initSession(
			msg.cwd,
			msg.filePath,
			msg.projectTrusted,
			msg.desktopSecurity,
		);
		return;
	}
	if (msg.kind === "terminate_run") {
		runTracker?.terminateRun(msg.runId);
		return;
	}
	if (msg.kind === "background_run") {
		runTracker?.backgroundRun(msg.runId);
		return;
	}
	if (msg.kind === "rpc_response") {
		handleRpcResponse(msg);
		return;
	}
	if (msg.kind !== "command") {
		return;
	}

	const { id, command } = msg;
	try {
		await runCommand(id, command);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		post({ kind: "result", id, error: message });
	}
}

async function runCommand(id: string, command: AgentCommand): Promise<void> {
	switch (command.type) {
		case "ping":
			post({ kind: "result", id, data: { ok: true } });
			return;
		case "hang":
			busyLoopMs(30_000);
			post({ kind: "result", id, data: { ok: true } });
			return;
		case "prompt": {
			const active = requireSession();
			let message = command.message;
			if (command.citations?.length) {
				message = formatCitationsBlock(command.citations) + message;
			}
			applyBuiltinBrowserToolGate(active, message, command.citations);
			pruneAgentToolResults(active);
			const images = normalizePromptImages(command.images);
			if (images?.length && !modelAcceptsImages(active)) {
				post({ kind: "result", id, error: formatNoVisionModelError() });
				return;
			}
			try {
				await active.prompt(message, images?.length ? { images } : undefined);
			} catch (err) {
				const errText = err instanceof Error ? err.message : String(err);
				await healAfterPromptFailure(active, Boolean(images?.length), errText);
				throw err;
			}
			// Many providers surface 400s as an assistant error message without throwing.
			const settledErr = lastAssistantErrorMessage(active);
			if (
				settledErr &&
				(Boolean(images?.length) || isImageSchemaPromptError(settledErr))
			) {
				await healAfterPromptFailure(active, Boolean(images?.length), settledErr);
			}
			post({ kind: "result", id, data: { promptDone: true } });
			return;
		}
		case "steer": {
			const active = requireSession();
			applyBuiltinBrowserToolGate(active, command.message);
			pruneAgentToolResults(active);
			const images = normalizePromptImages(command.images);
			if (images?.length && !modelAcceptsImages(active)) {
				post({ kind: "result", id, error: formatNoVisionModelError() });
				return;
			}
			try {
				await active.steer(command.message, images?.length ? images : undefined);
			} catch (err) {
				const errText = err instanceof Error ? err.message : String(err);
				await healAfterPromptFailure(active, Boolean(images?.length), errText);
				throw err;
			}
			post({ kind: "result", id, data: { ok: true } });
			return;
		}
		case "rollback_user": {
			const active = requireSession();
			const ok = await rollbackUserTurn(active, command.userIndex, command.expectText);
			post({ kind: "result", id, data: { ok } });
			return;
		}
		case "follow_up": {
			const active = requireSession();
			applyBuiltinBrowserToolGate(active, command.message);
			pruneAgentToolResults(active);
			await active.followUp(command.message);
			post({ kind: "result", id, data: { ok: true } });
			return;
		}
		case "abort":
			await requireSession().abort();
			post({ kind: "result", id, data: { ok: true } });
			return;
		case "set_model": {
			const active = requireSession();
			const models = await active.modelRuntime.getAvailable();
			const model = models.find(
				(m) => m.provider === command.provider && m.id === command.modelId,
			);
			if (!model) {
				post({
					kind: "result",
					id,
					error: `Model not found: ${command.provider}/${command.modelId}`,
				});
				return;
			}
			await setModelPreservingThinking(active, model);
			emitContextUsage(active);
			post({ kind: "result", id, data: { ok: true } });
			return;
		}
		case "set_thinking_level": {
			// 重新广播一次，界面上的模型/思考标注立即跟上选择器。
			// 界面档位静默路由（Minimal→Low、Medium→High），返回值是实际生效等级。
			const active = requireSession();
			active.setThinkingLevel(routedThinkingLevel(command.level as ThinkingLevel));
			emitContextUsage(active);
			post({ kind: "result", id, data: { ok: true, level: active.thinkingLevel } });
			return;
		}
		case "compact": {
			const active = requireSession();
			// Light prune first so the summarizer sees less tool noise / fewer tokens.
			pruneAgentToolResults(active);
			await active.compact(command.customInstructions);
			emitContextUsage(active);
			post({ kind: "result", id, data: { ok: true } });
			return;
		}
		case "get_state": {
			const active = requireSession();
			post({
				kind: "result",
				id,
				data: {
					model: active.model,
					thinkingLevel: active.thinkingLevel,
					isStreaming: active.isStreaming,
					sessionFile: active.sessionFile,
					sessionId: active.sessionId,
					sessionName: active.sessionName,
					messageCount: active.messages.length,
					contextUsage: (() => {
						const usage = readContextUsage(active);
						return usage ? { ...usage, ...timingStats() } : null;
					})(),
				},
			});
			return;
		}
		default: {
			const _exhaustive: never = command;
			void _exhaustive;
			post({ kind: "result", id, error: "unsupported command" });
		}
	}
}

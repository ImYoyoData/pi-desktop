import {
	createAgentSession,
	getAgentDir,
	SessionManager,
	type AgentSession,
} from "@oh-my-pi/pi-coding-agent";
import { getBlobsDir } from "@oh-my-pi/pi-utils";
import { parseThinkingLevel } from "@oh-my-pi/pi-tui/thinking";
import type { OmpAvailableModel } from "../shared/omp-models";
import type { OmpWorkerInbound } from "../shared/omp-worker-messages";
import type { AgentCommand } from "../shared/protocol";
import { toPromptImages } from "../shared/protocol";
import { isThinkingLevel, type ThinkingLevel } from "../shared/thinking-level";
import {
	DEFAULT_CONTEXT_WINDOW,
	resolveContextWindow,
	resolveMaxTokens,
} from "../shared/model-metadata";
import { stripThinkingLanguageBlock } from "../shared/thinking-language";
import { createOmpAskUserTool } from "./ask-user-tool";
import { readAgentTranscript } from "./agent-transcript";
import { forkOmpUserTurn } from "./fork";
import {
	CONTEXT_USAGE_EVENT_TYPES,
	emitContextUsage,
	observeOmpTiming,
	readOmpContextUsage,
	restoreOmpTiming,
} from "./context-usage";
import { handleOmpRpcResponse, setRpcWorkspaceRoot } from "./main-rpc";
import { activateExtensionUI } from "./extension-runner";
import { createOmpDesktopExtensionUIContext, takeExtensionUiRewind } from "./extension-ui-context";
import {
	noteLoopPrompt,
	pauseLoopMode,
	restoreDesktopModes,
	runDesktopSlashCommand,
	scheduleLoopIteration,
} from "./desktop-slash";
import {
	fillOmpCancelledToolResults,
	rollbackOmpTurnEnd,
	rollbackOmpUserTurn,
} from "./rollback";
import { post } from "./transport";

let session: AgentSession | null = null;
let initStarted = false;

/** 流式快照只保留最新一帧，其余事件立即发送（跨进程序列化成本随输出长度爆炸）。 */
function createEventThrottle(intervalMs = 40) {
	let pending: Record<string, unknown> | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;

	function flush(): void {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		if (!pending) return;
		const event = pending;
		pending = null;
		post({ kind: "event", event });
	}

	return (event: Record<string, unknown>): void => {
		const snapshot =
			event.type === "message_update" || event.type === "tool_execution_update";
		if (!snapshot) {
			flush();
			post({ kind: "event", event });
			return;
		}
		pending = event;
		if (!timer) timer = setTimeout(flush, intervalMs);
	};
}

/** OMP 的档位集合含 auto/inherit，桌面只认具体档位。 */
function ompThinkingLevels(active: AgentSession): ThinkingLevel[] {
	const levels: ThinkingLevel[] = [];
	for (const level of active.getAvailableEffortSelectors()) {
		if (isThinkingLevel(level)) levels.push(level);
	}
	return levels;
}

/** OMP 的档位集合含 auto/inherit，桌面只认具体档位；未指定或继承时为 null。 */
function ompThinkingLevel(active: AgentSession): ThinkingLevel | null {
	return isThinkingLevel(active.thinkingLevel) ? active.thinkingLevel : null;
}

function requireSession(): AgentSession {
	if (!session) {
		throw new Error("omp worker session not initialized");
	}
	return session;
}

/**
 * omp 的档位集合含 auto/inherit，桌面只保留具体档位；非推理模型只有 off。
 *
 * 取法对齐 SDK 的 getSupportedEfforts：非推理 → 空；推理但无可控档位 → 空。
 */
function modelThinkingLevels(model: {
	reasoning?: boolean;
	thinking?: { efforts?: readonly string[] };
}): ThinkingLevel[] {
	const levels: ThinkingLevel[] = ["off"];
	if (model.reasoning !== true) return levels;
	for (const effort of model.thinking?.efforts ?? []) {
		if (isThinkingLevel(effort) && !levels.includes(effort)) levels.push(effort);
	}
	return levels;
}

/**
 * worker 侧真实的可用模型（已按凭据过滤）。
 *
 * 排序与 pi 侧保持一致（provider 后按名字），composer 菜单才能稳定分组。
 */
function listAvailableModels(active: AgentSession): OmpAvailableModel[] {
	const rows = active.getAvailableModels().map((model) => ({
		provider: model.provider,
		id: model.id,
		name: model.name || model.id,
		api: model.api,
		// 与 pi 侧 ModelsAvailableEntry 同形：缺失值用公共默认，而非 null。
		contextWindow:
			resolveContextWindow(model.contextWindow, model.id) ?? DEFAULT_CONTEXT_WINDOW,
		maxTokens: resolveMaxTokens(model.maxTokens),
		input: Array.isArray(model.input) ? [...model.input] : [],
		reasoning: model.reasoning === true,
		thinkingLevels: modelThinkingLevels(model),
		cost: {
			input: model.cost?.input ?? 0,
			output: model.cost?.output ?? 0,
			cacheRead: model.cost?.cacheRead ?? 0,
			cacheWrite: model.cost?.cacheWrite ?? 0,
		},
	}));
	return rows.sort((a, b) => {
		const byProvider = a.provider.localeCompare(b.provider);
		if (byProvider !== 0) return byProvider;
		return (a.name || a.id).localeCompare(b.name || b.id, undefined, { numeric: true });
	});
}

async function openSessionManager(
	cwd: string,
	agentDir: string,
	filePath?: string,
): Promise<SessionManager> {
	const trimmed = filePath?.trim();
	if (trimmed) {
		try {
			return await SessionManager.open(trimmed, undefined, undefined, {
				throwIfMissing: true,
				initialCwd: cwd,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			process.stderr.write(
				`[omp-worker] open session failed, creating new: ${message}\n`,
			);
		}
	}
	// 兜底新建时也落在主进程给的目录下，避免 SDK 自己按环境变量另算一份。
	return SessionManager.create(
		cwd,
		SessionManager.getDefaultSessionDir(cwd, agentDir),
	);
}

async function initSession(
	cwd: string,
	filePath?: string,
	agentDirEnv?: string,
): Promise<void> {
	if (initStarted) {
		return;
	}
	initStarted = true;
	try {
		await startSession(cwd, filePath, agentDirEnv);
	} catch (err) {
		initStarted = false;
		throw err;
	}
}

async function startSession(
	cwd: string,
	filePath?: string,
	agentDirEnv?: string,
): Promise<void> {
	// 目录由主进程单点决定：worker 不再按自己的环境变量另算。
	const agentDir = agentDirEnv?.trim() || getAgentDir();
	setRpcWorkspaceRoot(cwd);
	const sessionManager = await openSessionManager(cwd, agentDir, filePath);
	const { session: created, modelFallbackMessage, setToolUIContext } =
		await createAgentSession({
			cwd,
			agentDir,
			sessionManager,
			customTools: [createOmpAskUserTool()],
		});
	// 扩展与工具审批的对话都走桌面卡片。
	const uiContext = createOmpDesktopExtensionUIContext();
	setToolUIContext(uiContext, true);
	if (modelFallbackMessage) {
		process.stderr.write(`[omp-worker] ${modelFallbackMessage}\n`);
	}
	restoreOmpTiming(created.sessionFile);
	const sendEvent = createEventThrottle();
	created.subscribe((event) => {
		const raw = event as unknown as Record<string, unknown>;
		observeOmpTiming(raw);
		sendEvent(raw);
		if (raw.type === "agent_end") scheduleLoopIteration(created);
		if (typeof raw.type !== "string") return;
		if (!CONTEXT_USAGE_EVENT_TYPES.has(raw.type)) return;
		try {
			emitContextUsage(created);
		} catch {
			// 用量上报是尽力而为。
		}
	});
	session = created;
	restoreDesktopModes(created);
	await activateExtensionUI(created, uiContext);
	post({
		kind: "ready",
		id: created.sessionId,
		filePath: created.sessionFile ?? "",
		cwd: created.sessionManager.getCwd(),
		agentDir,
		blobsDir: getBlobsDir(),
	});
}

/** 命令回显要先标记，SDK 写入的用户消息才能替换它而不是再叠加一条。 */
function echoSlashPrompt(command: string): void {
	post({ kind: "event", event: { type: "desktop_slash_prompt", command } });
}

async function runCommand(id: string, command: AgentCommand): Promise<void> {
	switch (command.type) {
		case "ping":
			post({ kind: "result", id, data: { ok: true } });
			return;
		case "prompt": {
			// omp 内建命令（/plan、/goal、/loop 等）由桌面桥执行，不进入模型。
			const active = requireSession();
			const message = stripThinkingLanguageBlock(command.message);
			const slash = await runDesktopSlashCommand(active, message);
			if (slash.handled) {
				active.emitNotice(slash.level, slash.message);
				if (slash.openFile) {
					post({
						kind: "event",
						event: { type: "desktop_open_file", path: slash.openFile },
					});
				}
				if (slash.prompt) {
					echoSlashPrompt(message);
					if (active.isStreaming) await active.steer(slash.prompt);
					else await active.prompt(slash.prompt);
				}
				post({ kind: "result", id, data: { promptDone: true, slashHandled: true } });
				return;
			}
			noteLoopPrompt(message);
			// SDK 会把 /命令 展开成提示词：回显由展开后的用户消息替换。
			if (message.trimStart().startsWith("/")) echoSlashPrompt(message);
			const images = toPromptImages(command.images);
			const options = active.isStreaming
				? { images, streamingBehavior: "steer" as const }
				: images?.length
					? { images }
					: undefined;
			for (;;) {
				await active.prompt(message, options);
				if (!takeExtensionUiRewind() || !message.startsWith("/")) break;
			}
			post({ kind: "result", id, data: { promptDone: true } });
			return;
		}
		case "steer": {
			const images = toPromptImages(command.images);
			await requireSession().steer(
				command.message,
				images?.length ? images : undefined,
			);
			post({ kind: "result", id, data: { ok: true } });
			return;
		}
		case "follow_up":
			await requireSession().followUp(command.message);
			post({ kind: "result", id, data: { ok: true } });
			return;
		case "abort":
			pauseLoopMode();
			await requireSession().abort();
			fillOmpCancelledToolResults(requireSession());
			post({ kind: "result", id, data: { ok: true } });
			return;
		case "clear_queue":
			post({ kind: "result", id, data: requireSession().clearQueue() });
			return;
		case "set_model": {
			const active = requireSession();
			const model = active.modelRegistry.find(command.provider, command.modelId);
			if (!model) {
				post({
					kind: "result",
					id,
					error: `Model not found: ${command.provider}/${command.modelId}`,
				});
				return;
			}
			await active.setModel(model);
			post({
				kind: "result",
				id,
				data: {
					ok: true,
					level: ompThinkingLevel(active),
					thinkingLevels: ompThinkingLevels(active),
				},
			});
			return;
		}
		case "fork_user_turn": {
			const active = requireSession();
			const filePath = active.sessionFile;
			if (!filePath) {
				post({ kind: "result", id, error: "session file not found" });
				return;
			}
			const data = await forkOmpUserTurn(
				filePath,
				command.userIndex,
				command.expectText,
			);
			post({ kind: "result", id, data });
			return;
		}
		case "set_session_name": {
			// 走 SDK 的改名：它同时更新内存里的标题与磁盘上的 title slot，
			// 避免主进程直接改文件后，worker 的整文件重写把旧名字写回。
			await requireSession().setSessionName(command.name, "user");
			post({ kind: "result", id, data: { ok: true } });
			return;
		}
		case "set_thinking_level": {
			const active = requireSession();
			const level = parseThinkingLevel(command.level);
			if (level === undefined) {
				throw new Error(`invalid thinking level: ${command.level}`);
			}
			active.setThinkingLevel(level, command.persist === true);
			post({
				kind: "result",
				id,
				data: {
					ok: true,
					level: ompThinkingLevel(active),
					thinkingLevels: ompThinkingLevels(active),
				},
			});
			return;
		}
		case "compact":
			await requireSession().compact(command.customInstructions);
			post({ kind: "result", id, data: { ok: true } });
			return;
		case "rollback_user": {
			const active = requireSession();
			const ok = await rollbackOmpUserTurn(
				active,
				command.userIndex,
				command.expectText,
			);
			post({ kind: "result", id, data: { ok } });
			return;
		}
		case "rollback_turn_end": {
			const active = requireSession();
			// 运行中先停下当前轮：会话树正在追加，直接回退会与流式输出争用。
			if (active.isStreaming) {
				await active.abort();
			}
			const ok = await rollbackOmpTurnEnd(
				active,
				command.userIndex,
				command.expectText,
			);
			// 停在一半的工具调用仍留在保留的链上，就地补齐。
			if (ok) fillOmpCancelledToolResults(active);
			post({ kind: "result", id, data: { ok } });
			return;
		}
		case "get_agent_transcript": {
			const active = requireSession();
			const transcript = await readAgentTranscript(
				command.agentId,
				active.sessionFile ?? null,
			);
			post({ kind: "result", id, data: transcript });
			return;
		}
		case "get_state": {
			const active = requireSession();
			post({
				kind: "result",
				id,
				data: {
					model: active.model,
					thinkingLevel: ompThinkingLevel(active),
					thinkingLevels: ompThinkingLevels(active),
					isStreaming: active.isStreaming,
					sessionFile: active.sessionFile,
					sessionId: active.sessionId,
					sessionName: active.sessionName,
					messageCount: active.messages.length,
					contextUsage: readOmpContextUsage(active),
				},
			});
			return;
		}
		case "list_models": {
			post({ kind: "result", id, data: listAvailableModels(requireSession()) });
			return;
		}
		default:
			post({
				kind: "result",
				id,
				error: `unsupported omp command: ${command.type}`,
			});
	}
}

export async function handleWorkerMessage(msg: OmpWorkerInbound): Promise<void> {
	if (msg.kind === "ping") {
		post({ kind: "pong" });
		return;
	}
	if (msg.kind === "rpc_response") {
		handleOmpRpcResponse(msg);
		return;
	}
	if (msg.kind === "shutdown") {
		await session?.dispose();
		process.exit(0);
	}
	if (msg.kind === "init") {
		await initSession(msg.cwd, msg.filePath, msg.agentDir);
		return;
	}
	if (msg.kind === "reload_models") {
		if (session) {
			void session.modelRegistry.refresh().catch((err: unknown) => {
				const message = err instanceof Error ? err.message : String(err);
				process.stderr.write(`[omp-worker] model reload failed: ${message}\n`);
			});
		}
		return;
	}
	if (msg.kind !== "command") {
		return;
	}
	await runCommand(msg.id, msg.command);
}

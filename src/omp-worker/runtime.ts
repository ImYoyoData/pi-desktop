import {
	createAgentSession,
	getAgentDir,
	SessionManager,
	type AgentSession,
} from "@oh-my-pi/pi-coding-agent";
import type { OmpWorkerInbound } from "../shared/omp-worker-messages";
import type { AgentCommand } from "../shared/protocol";
import { toPromptImages } from "../shared/protocol";
import { createOmpAskUserTool } from "./ask-user-tool";
import {
	CONTEXT_USAGE_EVENT_TYPES,
	emitContextUsage,
	readOmpContextUsage,
} from "./context-usage";
import { handleOmpRpcResponse, setRpcWorkspaceRoot } from "./main-rpc";
import { createOmpDesktopExtensionUIContext } from "./extension-ui-context";
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

function requireSession(): AgentSession {
	if (!session) {
		throw new Error("omp worker session not initialized");
	}
	return session;
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
	setToolUIContext(createOmpDesktopExtensionUIContext(), true);
	if (modelFallbackMessage) {
		process.stderr.write(`[omp-worker] ${modelFallbackMessage}\n`);
	}
	created.subscribe(
		createEventThrottle() as Parameters<AgentSession["subscribe"]>[0],
	);
	created.subscribe((event: { type?: unknown }) => {
		if (typeof event.type !== "string") return;
		if (!CONTEXT_USAGE_EVENT_TYPES.has(event.type)) return;
		try {
			emitContextUsage(created);
		} catch {
			// 用量上报是尽力而为。
		}
	});
	session = created;
	post({
		kind: "ready",
		id: created.sessionId,
		filePath: created.sessionFile ?? "",
		cwd: created.sessionManager.getCwd(),
		agentDir,
	});
}

async function runCommand(id: string, command: AgentCommand): Promise<void> {
	switch (command.type) {
		case "ping":
			post({ kind: "result", id, data: { ok: true } });
			return;
		case "prompt": {
			const images = toPromptImages(command.images);
			await requireSession().prompt(
				command.message,
				images?.length ? { images } : undefined,
			);
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
			active.setModel(model);
			post({ kind: "result", id, data: { ok: true } });
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
			active.setThinkingLevel(
				command.level as Parameters<AgentSession["setThinkingLevel"]>[0],
				command.persist === true,
			);
			post({
				kind: "result",
				id,
				data: { ok: true, level: active.thinkingLevel },
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
					contextUsage: readOmpContextUsage(active),
				},
			});
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

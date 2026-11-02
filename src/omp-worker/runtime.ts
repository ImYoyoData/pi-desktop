import {
	createAgentSession,
	getAgentDir,
	SessionManager,
	type AgentSession,
} from "@oh-my-pi/pi-coding-agent";
import type { OmpWorkerInbound } from "../shared/omp-worker-messages";
import type { AgentCommand } from "../shared/protocol";
import { toPromptImages } from "../shared/protocol";
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
	return SessionManager.create(cwd);
}

async function initSession(cwd: string, filePath?: string): Promise<void> {
	if (initStarted) {
		return;
	}
	initStarted = true;
	const agentDir = getAgentDir();
	const sessionManager = await openSessionManager(cwd, filePath);
	const { session: created, modelFallbackMessage } = await createAgentSession({
		cwd,
		agentDir,
		sessionManager,
	});
	if (modelFallbackMessage) {
		process.stderr.write(`[omp-worker] ${modelFallbackMessage}\n`);
	}
	created.subscribe(
		createEventThrottle() as Parameters<AgentSession["subscribe"]>[0],
	);
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
					contextUsage: null,
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
	if (msg.kind === "shutdown") {
		await session?.dispose();
		process.exit(0);
	}
	if (msg.kind === "init") {
		await initSession(msg.cwd, msg.filePath);
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

import type { AgentSession } from "@oh-my-pi/pi-coding-agent";
import { executeAcpBuiltinSlashCommand } from "@oh-my-pi/pi-coding-agent/slash-commands/acp-builtins";
import { parseSlashCommand } from "@oh-my-pi/pi-coding-agent/slash-commands/helpers/parse";
import {
	consumeLoopLimitIteration,
	createLoopLimitRuntime,
	describeLoopLimitRuntime,
	isLoopDurationExpired,
	isLoopLimitExhausted,
	parseLoopArgs,
} from "@oh-my-pi/pi-coding-agent/modes/loop-limit";
import {
	describeLoopCondition,
	evaluateLoopCondition,
} from "@oh-my-pi/pi-coding-agent/modes/loop-condition";
import { cfgLoopConditionTimeoutMs } from "@oh-my-pi/pi-coding-agent/modes/settings";
import { resolvePlanFilePath } from "@oh-my-pi/pi-coding-agent/plan-mode/plan-files";
import type {
	LoopConditionConfig,
	LoopLimitRuntime,
} from "@oh-my-pi/pi-tui/status-line/loop";
import { readFile } from "node:fs/promises";
import { rpcToMain } from "./main-rpc";
import { findOmpSlashCommand } from "../shared/slash-commands";

export type DesktopSlashOutcome =
	| { handled: false }
	| {
			handled: true;
			level: "info" | "warning" | "error";
			message: string;
			/** 命令附带的首轮提示，worker 会在处理后发送。 */
			prompt?: string;
			/** 需要桌面打开的文件（如计划文件）。 */
			openFile?: string;
	  };

const notHandled: DesktopSlashOutcome = { handled: false };

let planPreviousTools: string[] | null = null;
let vibePreviousTools: string[] | null = null;
let goalPreviousTools: string[] | null = null;

type LoopState = {
	prompt?: string;
	limit?: LoopLimitRuntime;
	condition?: LoopConditionConfig;
	paused: boolean;
};

let loopState: LoopState | null = null;
let loopTimer: NodeJS.Timeout | null = null;
let loopRunning = false;
let loopConditionAbort: AbortController | null = null;

function info(message: string, prompt?: string): DesktopSlashOutcome {
	return { handled: true, level: "info", message, ...(prompt ? { prompt } : {}) };
}

function warn(message: string, prompt?: string): DesktopSlashOutcome {
	return { handled: true, level: "warning", message, ...(prompt ? { prompt } : {}) };
}

function modeBlocked(session: AgentSession): DesktopSlashOutcome | null {
	if (session.getPlanModeState()?.enabled) return warn("Exit plan mode first.");
	if (session.getVibeModeState()?.enabled) return warn("Exit vibe mode first.");
	if (session.getGoalModeState()?.enabled) return warn("Exit goal mode first.");
	return null;
}

async function restorePlanTools(session: AgentSession): Promise<void> {
	const previous = planPreviousTools;
	planPreviousTools = null;
	if (previous) await session.setActiveToolsByName(previous);
}

async function leavePlanMode(session: AgentSession): Promise<void> {
	session.setPlanProposalHandler(null);
	session.setPlanModeState(undefined);
	await restorePlanTools(session);
	session.sessionManager.appendModeChange("none");
}

async function approvePlan(session: AgentSession, title: string) {
	const review = await session.preparePlanForReview(title);
	const details = review.details as { planFilePath?: string; title?: string };
	const planPath = details.planFilePath;
	let planText = "";
	if (planPath) {
		try {
			const resolved = resolvePlanFilePath(planPath, {
				localProtocolOptions: {
					getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
					getSessionId: () => session.sessionManager.getSessionId(),
				},
				cwd: session.sessionManager.getCwd(),
			});
			planText = await readFile(resolved, "utf8");
		} catch {
			// 计划文件读不到时只展示路径，批准流程仍可进行。
		}
	}
	let answer = "";
	try {
		const raw = await rpcToMain(
			"desktop.askUser",
			{
				questions: [
					{
						id: "plan_approval",
						header: "Plan",
						prompt: ["Approve this plan?", planText || planPath || details.title || title]
							.filter(Boolean)
							.join("\n\n"),
						type: "single",
						skippable: false,
						options: [
							{
								id: "approve",
								label: "Approve and execute",
								description: "Exit plan mode and start implementation.",
							},
							{
								id: "refine",
								label: "Refine plan",
								description: "Keep planning and revise the plan file.",
							},
						],
					},
				],
			},
			null,
		);
		answer =
			typeof raw === "string"
				? raw
				: String((raw as { text?: unknown } | null)?.text ?? "");
	} catch {
		answer = "";
	}
	if (!/approve/i.test(answer)) {
		const state = session.getPlanModeState();
		if (planPath && state && state.planFilePath !== planPath) {
			session.setPlanModeState({ ...state, planFilePath: planPath });
		}
		return {
			content: [
				{
					type: "text" as const,
					text: "Plan refinement requested. Update the plan file, then write the title to xd://propose again when ready.",
				},
			],
			details,
		};
	}
	if (planPath) session.setPlanReferencePath(planPath);
	await leavePlanMode(session);
	session.emitNotice(
		"info",
		`Plan approved: ${details.title ?? title}${planPath ? ` (${planPath})` : ""}`,
	);
	return {
		content: [
			{
				type: "text" as const,
				text: `Plan approved at ${planPath ?? title}. Plan mode exited; proceed with the implementation.`,
			},
		],
		details,
	};
}

/** worker 重启后重新挂载计划提交处理器；工具集按会话恢复结果使用。 */
export function restoreDesktopModes(session: AgentSession): void {
	if (session.getPlanModeState()?.enabled) {
		session.setPlanProposalHandler((title) => approvePlan(session, title));
	}
}

async function planCommand(
	session: AgentSession,
	initialPrompt: string,
): Promise<DesktopSlashOutcome> {
	if (session.getPlanModeState()?.enabled) {
		await leavePlanMode(session);
		return info("Plan mode disabled.");
	}
	if (session.getGoalModeState()?.enabled) return warn("Exit goal mode first.");
	if (session.getVibeModeState()?.enabled) return warn("Exit vibe mode first.");
	const planFilePath = session.getPlanReferencePath() || "local://PLAN.md";
	const previousTools = session.getEnabledToolNames();
	planPreviousTools = previousTools;
	const planTools = [
		...new Set([
			...previousTools.filter((name) => name !== "write"),
			...(session.hasBuiltInTool("write") ? ["write"] : []),
		]),
	];
	session.setPlanModeState({
		enabled: true,
		planFilePath,
		workflow: "parallel",
		reentry: false,
	});
	try {
		await session.setActiveToolsByName(planTools);
	} catch (error) {
		session.setPlanModeState(undefined);
		planPreviousTools = null;
		throw error;
	}
	session.setPlanProposalHandler((title) => approvePlan(session, title));
	await session.sendPlanModeContext(
		session.isStreaming ? { deliverAs: "steer" } : undefined,
	);
	session.sessionManager.appendModeChange("plan", { planFilePath });
	return info(
		`Plan mode enabled. Plan file: ${planFilePath}`,
		initialPrompt || undefined,
	);
}

async function vibeCommand(
	session: AgentSession,
	initialPrompt: string,
): Promise<DesktopSlashOutcome> {
	if (session.getVibeModeState()?.enabled) {
		if (session.isStreaming) await session.abort();
		// worker 重启后进入时的工具集快照会丢失，退回已注册的完整工具集。
		await session.deactivateVibeTools(
			vibePreviousTools ?? session.getAllToolNames(),
		);
		vibePreviousTools = null;
		session.setVibeModeState(undefined);
		session.sessionManager.appendModeChange("none");
		return info("Vibe mode disabled.");
	}
	const blocked = modeBlocked(session);
	if (blocked) return blocked;
	vibePreviousTools = session.getEnabledToolNames();
	const baseTools = ["read", ...(session.hasBuiltInTool("todo") ? ["todo"] : [])];
	await session.activateVibeTools(baseTools);
	session.setVibeModeState({ enabled: true });
	if (session.isStreaming) await session.sendVibeModeContext({ deliverAs: "steer" });
	session.sessionManager.appendModeChange("vibe", {
		previousTools: vibePreviousTools,
	});
	return info(
		"Vibe mode enabled. Toolset is read-only.",
		initialPrompt || undefined,
	);
}

function goalStatus(session: AgentSession): string {
	const state = session.getGoalModeState();
	if (!state?.goal) return "No active goal.";
	const budget =
		state.goal.tokenBudget === undefined
			? "none"
			: String(state.goal.tokenBudget);
	return `Goal (${state.goal.status}): ${state.goal.objective} · tokens ${state.goal.tokensUsed}/${budget}`;
}

async function enterGoal(
	session: AgentSession,
	objective: string,
): Promise<DesktopSlashOutcome> {
	const previousTools = session.getEnabledToolNames().filter((name) => name !== "goal");
	goalPreviousTools = previousTools;
	const state = await session.goalRuntime.createGoal({ objective });
	await session.setActiveToolsByName([...previousTools, "goal"]);
	session.setGoalModeState(state);
	if (session.isStreaming) {
		await session.sendGoalModeContext({ deliverAs: "steer" });
	}
	return info(`Goal mode enabled: ${objective}`, objective);
}

async function exitGoal(
	session: AgentSession,
	options?: { persist?: boolean },
): Promise<void> {
	const previous = goalPreviousTools;
	goalPreviousTools = null;
	if (previous) await session.setActiveToolsByName(previous);
	session.setGoalModeState(undefined);
	if (options?.persist !== false) session.sessionManager.appendModeChange("none");
}

async function goalCommand(
	session: AgentSession,
	args: string,
): Promise<DesktopSlashOutcome> {
	if (session.getPlanModeState()?.enabled) return warn("Exit plan mode first.");
	if (session.getVibeModeState()?.enabled) return warn("Exit vibe mode first.");
	const [verbRaw, ...restParts] = args.trim().split(/\s+/);
	const verb = verbRaw?.toLowerCase() ?? "";
	const rest = restParts.join(" ").trim();
	const runtime = session.goalRuntime;
	switch (verb) {
		case "":
		case "show":
			return info(goalStatus(session));
		case "pause": {
			const state = await runtime.pauseGoal();
			if (!state) return warn("No active goal.");
			await exitGoal(session, { persist: false });
			session.setGoalModeState(state);
			return info("Goal paused.");
		}
		case "resume": {
			const state = await runtime.resumeGoal();
			const tools = session.getEnabledToolNames();
			if (!tools.includes("goal")) {
				goalPreviousTools = tools.filter((name) => name !== "goal");
				await session.setActiveToolsByName([...tools, "goal"]);
			}
			session.setGoalModeState(state);
			if (session.isStreaming) {
				await session.sendGoalModeContext({ deliverAs: "steer" });
			}
			return info("Goal resumed.");
		}
		case "drop": {
			const dropped = await runtime.dropGoal();
			await exitGoal(session);
			return info(dropped ? "Goal dropped." : "No active goal.");
		}
		case "budget": {
			const state = session.getGoalModeState();
			if (!state?.goal) return warn("No active goal.");
			if (!rest) {
				return info(
					state.goal.tokenBudget === undefined
						? "Goal budget is unbounded. Use /goal budget <N> to limit it."
						: `Goal budget: ${state.goal.tokenBudget} tokens. Use /goal budget off to clear it.`,
				);
			}
			const value =
				rest.toLowerCase() === "off"
					? undefined
					: Number.parseInt(rest, 10);
			if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
				return warn("Goal budget must be a positive integer or `off`.");
			}
			await runtime.onBudgetMutated(value);
			return info(value === undefined ? "Goal budget cleared." : `Goal budget set to ${value}.`);
		}
		case "set":
			return rest ? await enterGoal(session, rest) : warn("Usage: /goal set <objective>");
		default:
			return await enterGoal(session, args.trim());
	}
}

async function guidedGoalCommand(
	session: AgentSession,
	objective: string,
): Promise<DesktopSlashOutcome> {
	if (session.getPlanModeState()?.enabled) return warn("Exit plan mode first.");
	if (session.getVibeModeState()?.enabled) return warn("Exit vibe mode first.");
	if (session.getGoalModeState()?.enabled) {
		return warn("Goal mode is already active. Use /goal to manage it.");
	}
	const tools = session.getEnabledToolNames();
	if (!tools.includes("goal")) {
		goalPreviousTools = tools.filter((name) => name !== "goal");
		await session.setActiveToolsByName([...tools, "goal"]);
	}
	const kickoff = [
		"You are setting up goal mode through a short interview.",
		"Ask the user only the questions needed to define one clear objective, its completion criteria, and any token budget.",
		"When you have the answers, call the `goal` tool with op `create` and the finalized objective.",
		objective ? `Initial objective from the user: ${objective}` : "",
	]
		.filter(Boolean)
		.join("\n");
	if (session.isStreaming) {
		await session.followUp(kickoff, undefined, { synthetic: true });
	} else {
		await session.prompt(kickoff, { synthetic: true });
	}
	return info("Goal interview started.");
}

function loopStatus(): string {
	if (!loopState) return "Loop mode is off.";
	const parts = ["Loop mode is on"];
	if (loopState.limit) parts.push(describeLoopLimitRuntime(loopState.limit));
	if (loopState.condition) parts.push(describeLoopCondition(loopState.condition));
	if (loopState.paused) parts.push("paused");
	return `${parts.join(" · ")}.`;
}

/** 停掉重发定时器与正在跑的条件命令。 */
function stopLoopScheduling(): void {
	loopRunning = false;
	loopConditionAbort?.abort();
	loopConditionAbort = null;
	if (loopTimer) {
		clearTimeout(loopTimer);
		loopTimer = null;
	}
}

async function loopCommand(args: string): Promise<DesktopSlashOutcome> {
	if (loopState && !args.trim()) {
		loopState = null;
		stopLoopScheduling();
		return info("Loop mode disabled.");
	}
	if (loopState) {
		stopLoopScheduling();
	}
	const parsed = parseLoopArgs(args);
	if (typeof parsed === "string") return warn(parsed);
	loopState = {
		prompt: parsed.prompt,
		limit: createLoopLimitRuntime(parsed.limit),
		condition: parsed.condition,
		paused: false,
	};
	return info(`Loop mode enabled. ${loopStatus()}`, parsed.prompt);
}

async function planReviewCommand(session: AgentSession): Promise<DesktopSlashOutcome> {
	const state = session.getPlanModeState();
	const path = state?.planFilePath || session.getPlanReferencePath();
	if (!path) return warn("No plan yet. Enable plan mode with /plan first.");
	try {
		const resolved = resolvePlanFilePath(path, {
			localProtocolOptions: {
				getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
				getSessionId: () => session.sessionManager.getSessionId(),
			},
			cwd: session.sessionManager.getCwd(),
		});
		return {
			handled: true,
			level: "info",
			message: `Plan file: ${resolved}`,
			openFile: resolved,
		};
	} catch {
		return info(`Plan file: ${path}`);
	}
}

const ANSI_ESCAPE = /\u001b\[[0-9;?]*[A-Za-z]/g;

async function acpCommand(
	session: AgentSession,
	text: string,
): Promise<DesktopSlashOutcome> {
	const chunks: string[] = [];
	const result = await executeAcpBuiltinSlashCommand(text, {
		session,
		sessionManager: session.sessionManager,
		settings: session.settings,
		cwd: session.sessionManager.getCwd(),
		output: (message) => {
			const clean = message.replace(ANSI_ESCAPE, "").replace(/\r/g, "");
			if (clean.trim()) chunks.push(clean);
		},
		refreshCommands: () => {},
		reloadPlugins: async () => {},
	});
	if (!result) {
		return warn("This command is only available in the omp terminal.");
	}
	if ("prompt" in result) {
		return info(chunks.join("\n") || "Command accepted.", result.prompt);
	}
	return info(chunks.join("\n") || "Command completed.");
}

export async function runDesktopSlashCommand(
	session: AgentSession,
	text: string,
): Promise<DesktopSlashOutcome> {
	const parsed = parseSlashCommand(text);
	if (!parsed) return notHandled;
	const entry = findOmpSlashCommand(parsed.name);
	if (!entry) return notHandled;
	switch (entry.name) {
		case "settings":
			return info("Open settings from the desktop settings page.");
		case "setup":
			return info("Open provider setup from the desktop settings page.");
		case "plan":
			return planCommand(session, parsed.args);
		case "plan-review":
			return planReviewCommand(session);
		case "vibe":
			return vibeCommand(session, parsed.args);
		case "goal":
			return goalCommand(session, parsed.args);
		case "guided-goal":
			return guidedGoalCommand(session, parsed.args);
		case "loop":
			return loopCommand(parsed.args);
		default:
			return entry.handles
				? acpCommand(session, text)
				: warn(`/${entry.name} is only available in the omp terminal.`);
	}
}

/** 普通 prompt 成为循环体：用户发下一条消息时记录并解除暂停。 */
export function noteLoopPrompt(text: string): void {
	const state = loopState;
	if (!state) return;
	state.prompt = text;
	state.paused = false;
}

/** agent_end 后由 worker 调度：循环模式有提示时重发。 */
export function scheduleLoopIteration(session: AgentSession): void {
	const state = loopState;
	if (!state || state.paused || !state.prompt || loopRunning) return;
	if (isLoopDurationExpired(state.limit) || isLoopLimitExhausted(state.limit)) {
		loopState = null;
		session.emitNotice("info", "Loop mode finished.");
		return;
	}
	// 上一次重发可能仍在收尾（compaction/流式），稍后再试，避免并发 prompt。
	if (session.isStreaming || session.isCompacting) {
		if (loopTimer) clearTimeout(loopTimer);
		loopTimer = setTimeout(() => {
			loopTimer = null;
			scheduleLoopIteration(session);
		}, 500);
		return;
	}
	loopRunning = true;
	loopTimer = setTimeout(() => {
		loopTimer = null;
		const current = loopState;
		if (!current || current.paused || !current.prompt) {
			loopRunning = false;
			return;
		}
		const prompt = current.prompt;
		void (async () => {
			try {
				if (current.condition) {
					loopConditionAbort = new AbortController();
					const verdict = await evaluateLoopCondition(current.condition, {
						cwd: session.sessionManager.getCwd(),
						timeoutMs: cfgLoopConditionTimeoutMs.get(session.settings),
						sessionId: session.sessionId,
						signal: loopConditionAbort.signal,
					});
					loopConditionAbort = null;
					if (verdict.kind !== "continue") {
						loopState = null;
						session.emitNotice(
							verdict.kind === "halt" ? "info" : "error",
							verdict.kind === "halt"
								? "Loop condition met."
								: verdict.kind === "aborted"
									? "Loop condition aborted."
									: verdict.message,
						);
						return;
					}
				}
				if (!consumeLoopLimitIteration(current.limit)) {
					loopState = null;
					session.emitNotice("info", "Loop mode finished.");
					return;
				}
				await session.prompt(prompt);
			} catch (error) {
				loopState = null;
				session.emitNotice(
					"error",
					`Loop stopped: ${error instanceof Error ? error.message : String(error)}`,
				);
			} finally {
				loopRunning = false;
			}
		})();
	}, 0);
}

/** `/loop` 关闭或用户中断时暂停循环。 */
export function pauseLoopMode(): void {
	if (loopState) loopState.paused = true;
	stopLoopScheduling();
}

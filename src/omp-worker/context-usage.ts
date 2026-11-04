import { readFileSync, writeFileSync } from "node:fs";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent";
import type {
	ContextUsageSegment,
	SessionContextUsage,
} from "../shared/protocol";
import {
	parseSessionTiming,
	sessionTimingPath,
	SessionTimingTracker,
} from "../shared/session-timing";
import { post } from "./transport";

/**
 * OMP 的上下文用量采集。
 *
 * OMP 直接提供 getContextUsage() / getContextBreakdown()，比 pi 侧按字符估算
 * 精确得多：tokens 与百分比用 SDK 的值，分段用 breakdown 的字段。
 */

/**
 * OMP 的 breakdown 字段 → 桌面端分段 id。
 *
 * 桌面端的分段 id 是 pi 定下的五类，OMP 的字段名不同，按语义归并：
 * 系统提示、上下文文件与技能都是注入系统的内容，合到 system。
 */
const SEGMENT_MAP: {
	keys: (
		| "systemPromptTokens"
		| "systemToolsTokens"
		| "systemContextTokens"
		| "skillsTokens"
		| "messagesTokens"
	)[];
	id: ContextUsageSegment["id"];
}[] = [
	{
		keys: ["systemPromptTokens", "systemContextTokens", "skillsTokens"],
		id: "system",
	},
	{ keys: ["systemToolsTokens"], id: "tools" },
	{ keys: ["messagesTokens"], id: "conversation" },
];

function num(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const timingTracker = new SessionTimingTracker();
let lastPersistedTimingJson = "";

/** 打开会话时恢复计时，否则重启后时长/首 token/平均都从零开始。 */
export function restoreOmpTiming(sessionFile: string | undefined): void {
	timingTracker.reset();
	lastPersistedTimingJson = "";
	if (!sessionFile) return;
	try {
		const timing = parseSessionTiming(
			JSON.parse(readFileSync(sessionTimingPath(sessionFile), "utf8")),
		);
		if (!timing) return;
		timingTracker.restore(timing);
		lastPersistedTimingJson = JSON.stringify(timing);
	} catch {
		// 没有计时文件就是新会话。
	}
}

/** 事件流喂给计时器，上下文用量上报时一起打包。 */
export function observeOmpTiming(event: unknown): void {
	timingTracker.observe(event);
}

function persistOmpTiming(sessionFile: string | undefined): void {
	if (!sessionFile) return;
	try {
		const json = JSON.stringify(timingTracker.snapshot());
		if (json === lastPersistedTimingJson) return;
		writeFileSync(sessionTimingPath(sessionFile), json, "utf8");
		lastPersistedTimingJson = json;
	} catch {
		// 计时只用于展示，写盘失败不影响会话。
	}
}

/** 读取当前会话的上下文用量；拿不到时返回 null。 */
export function readOmpContextUsage(
	active: AgentSession,
): SessionContextUsage | null {
	let usage: ReturnType<AgentSession["getContextUsage"]>;
	try {
		usage = active.getContextUsage();
	} catch {
		return null;
	}
	if (!usage) return null;

	const model = active.model ?? null;
	const result: SessionContextUsage = {
		tokens: num(usage.tokens) ?? null,
		contextWindow: num(usage.contextWindow) ?? 0,
		percent: num(usage.percent) ?? null,
		model: model ? { provider: model.provider, id: model.id } : null,
		thinkingLevel: active.thinkingLevel ?? null,
	};

	try {
		const stats = active.getSessionStats();
		result.toolCalls = num(stats.toolCalls) ?? null;
		result.turns = num(stats.userMessages) ?? null;
		result.steps = num(stats.assistantMessages) ?? null;
		result.messageCount = num(stats.totalMessages) ?? null;
		result.inputTokens = num(stats.tokens?.input) ?? null;
		result.outputTokens = num(stats.tokens?.output) ?? null;
		result.cacheReadTokens = num(stats.tokens?.cacheRead) ?? null;
		result.cacheWriteTokens = num(stats.tokens?.cacheWrite) ?? null;
		result.costUsd = num(stats.cost) ?? null;
	} catch {
		// 统计不可用时只保留用量本身。
	}

	try {
		const breakdown = active.getContextBreakdown();
		if (breakdown) {
			const segments: ContextUsageSegment[] = [];
			for (const entry of SEGMENT_MAP) {
				let tokens = 0;
				for (const key of entry.keys) tokens += num(breakdown[key]) ?? 0;
				if (tokens > 0) segments.push({ id: entry.id, tokens });
			}
			if (segments.length) result.segments = segments;
		}
	} catch {
		// 分段不可用时用量条只显示总量。
	}

	const timing = timingTracker.snapshot();
	result.llmDurationMs = timing.llmMs > 0 ? timing.llmMs : null;
	result.ttftMs = timing.ttftSteps > 0 ? timing.ttftMs / timing.ttftSteps : null;
	result.ttftSteps = timing.ttftSteps > 0 ? timing.ttftSteps : null;
	result.tokensPerSecond =
		timing.decodeMs > 0 ? timing.outputTokens / (timing.decodeMs / 1000) : null;

	return result;
}

/** 这些事件之后上下文用量可能变了，采集一次。 */
export const CONTEXT_USAGE_EVENT_TYPES = new Set([
	"agent_end",
	"agent_settled",
	"message_end",
	"compaction_end",
	"turn_end",
	"tool_execution_end",
]);

/** 把当前会话的上下文用量报给主进程（桌面端渲染成用量条）。 */
export function emitContextUsage(active: AgentSession): void {
	const usage = readOmpContextUsage(active);
	if (!usage) return;
	persistOmpTiming(active.sessionFile);
	const model = active.model;
	post({
		kind: "event",
		event: {
			type: "context_usage",
			tokens: usage.tokens,
			contextWindow: usage.contextWindow,
			percent: usage.percent,
			model: model ? { provider: model.provider, id: model.id } : null,
			thinkingLevel: usage.thinkingLevel ?? null,
			toolCalls: usage.toolCalls ?? null,
			messageCount: usage.messageCount ?? null,
			turns: usage.turns ?? null,
			steps: usage.steps ?? null,
			inputTokens: usage.inputTokens ?? null,
			outputTokens: usage.outputTokens ?? null,
			cacheReadTokens: usage.cacheReadTokens ?? null,
			cacheWriteTokens: usage.cacheWriteTokens ?? null,
			costUsd: usage.costUsd ?? null,
			llmDurationMs: usage.llmDurationMs ?? null,
			ttftMs: usage.ttftMs ?? null,
			ttftSteps: usage.ttftSteps ?? null,
			tokensPerSecond: usage.tokensPerSecond ?? null,
			segments: usage.segments ?? null,
		},
	});
}

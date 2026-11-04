export type SessionTiming = {
	llmMs: number;
	ttftMs: number;
	ttftSteps: number;
	decodeMs: number;
	outputTokens: number;
};

export const SESSION_TIMING_SUFFIX = ".timing.json";

export function sessionTimingPath(filePath: string): string {
	return `${filePath}${SESSION_TIMING_SUFFIX}`;
}

function finiteNonNegative(v: unknown): v is number {
	return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

const ZERO_TIMING: SessionTiming = {
	llmMs: 0,
	ttftMs: 0,
	ttftSteps: 0,
	decodeMs: 0,
	outputTokens: 0,
};

function roleOfMessage(raw: unknown): string {
	if (!raw || typeof raw !== "object") return "";
	const msg = raw as Record<string, unknown>;
	return typeof msg.role === "string" ? msg.role : "";
}

function outputOfMessage(raw: unknown): number {
	if (!raw || typeof raw !== "object") return 0;
	const usage = (raw as Record<string, unknown>).usage;
	if (!usage || typeof usage !== "object") return 0;
	const output = (usage as Record<string, unknown>).output;
	return typeof output === "number" && Number.isFinite(output) && output > 0
		? output
		: 0;
}

/**
 * 由 AgentSession 事件流累积会话计时：整步 LLM 墙钟、首 token 延迟、解码吞吐。
 * 总量跨会话累积，`snapshot()` 还会带上正在进行的这一步。
 */
export class SessionTimingTracker {
	private timing: SessionTiming = { ...ZERO_TIMING };
	private turnStart: number | null = null;
	private stepStart: number | null = null;
	private firstToken: number | null = null;

	/** 喂入一条原始 AgentSession 事件。 */
	observe(event: unknown): void {
		const raw = event as Record<string, unknown> | null | undefined;
		if (!raw || typeof raw !== "object") return;
		const type = raw.type;
		const now = Date.now();
		if (type === "turn_start") {
			this.turnStart = now;
			this.stepStart = now;
			this.firstToken = null;
			return;
		}
		if (type === "message_update") {
			if (this.firstToken === null && this.stepStart !== null) {
				const ev = raw.assistantMessageEvent as
					| Record<string, unknown>
					| undefined;
				const evType = typeof ev?.type === "string" ? ev.type : "";
				if (
					evType === "text_delta" ||
					evType === "thinking_delta" ||
					evType === "toolcall_delta" ||
					evType === "text_start" ||
					evType === "thinking_start" ||
					evType === "toolcall_start"
				) {
					this.firstToken = now;
				}
			}
			return;
		}
		if (type === "message_end") {
			const msg = raw.message;
			if (roleOfMessage(msg) === "assistant") {
				if (this.stepStart !== null) {
					this.timing.llmMs += Math.max(0, now - this.stepStart);
					this.stepStart = null;
				}
				if (this.firstToken !== null) {
					if (this.turnStart !== null) {
						this.timing.ttftMs += Math.max(0, this.firstToken - this.turnStart);
						this.timing.ttftSteps += 1;
					}
					const out = outputOfMessage(msg);
					if (out > 0) {
						this.timing.decodeMs += Math.max(0, now - this.firstToken);
						this.timing.outputTokens += out;
					}
				}
				this.firstToken = null;
				this.turnStart = null;
			}
			return;
		}
		if (
			type === "agent_end" ||
			type === "agent_settled" ||
			type === "turn_end"
		) {
			if (this.stepStart !== null) {
				this.timing.llmMs += Math.max(0, now - this.stepStart);
				this.stepStart = null;
			}
			this.firstToken = null;
			return;
		}
	}

	/** 当前总量，含进行中的这一步。 */
	snapshot(): SessionTiming {
		const now = Date.now();
		const inflight =
			this.stepStart !== null ? Math.max(0, now - this.stepStart) : 0;
		return {
			...this.timing,
			llmMs: this.timing.llmMs + inflight,
		};
	}

	restore(timing: SessionTiming): void {
		this.timing = { ...timing };
		this.turnStart = null;
		this.stepStart = null;
		this.firstToken = null;
	}

	reset(): void {
		this.timing = { ...ZERO_TIMING };
		this.turnStart = null;
		this.stepStart = null;
		this.firstToken = null;
	}
}

export function parseSessionTiming(raw: unknown): SessionTiming | null {
	if (!raw || typeof raw !== "object") return null;
	const t = raw as Record<string, unknown>;
	if (
		!finiteNonNegative(t.llmMs) ||
		!finiteNonNegative(t.ttftMs) ||
		!finiteNonNegative(t.ttftSteps) ||
		!finiteNonNegative(t.decodeMs) ||
		!finiteNonNegative(t.outputTokens)
	) {
		return null;
	}
	return {
		llmMs: t.llmMs,
		ttftMs: t.ttftMs,
		ttftSteps: t.ttftSteps,
		decodeMs: t.decodeMs,
		outputTokens: t.outputTokens,
	};
}

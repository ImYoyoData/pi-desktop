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

/**
 * Helpers for rolling back poisoned user turns in the Pi session tree
 * (e.g. image_url payloads rejected by a non-vision OpenAI-compat endpoint).
 */

export function isImageSchemaPromptError(message: string): boolean {
	const m = message.toLowerCase();
	return (
		m.includes("image_url") ||
		(m.includes("unknown variant") && m.includes("image")) ||
		(m.includes("expected 'text'") && m.includes("image")) ||
		m.includes("does not support image") ||
		m.includes("images are not supported") ||
		(m.includes("vision") && m.includes("not support"))
	);
}

/** Stable worker error prefix — renderer maps this to i18n. */
export const NO_VISION_ERROR_PREFIX = "PI_MODEL_NO_VISION:";

export function isNoVisionModelError(message: string): boolean {
	return message.includes(NO_VISION_ERROR_PREFIX) || isImageSchemaPromptError(message);
}

export function formatNoVisionModelError(): string {
	return `${NO_VISION_ERROR_PREFIX} Current model does not accept images. Switch to a vision-capable model, or remove images and send again.`;
}

/** 只取判断孤儿工具结果所需的会话条目字段。 */
export type SessionEntryLike = {
	id: string;
	type?: unknown;
	targetId?: unknown;
	replacement?: unknown;
	message?: {
		role?: unknown;
		stopReason?: unknown;
		content?: unknown;
		toolCallId?: unknown;
	};
};

/**
 * 找出该从模型上下文里摘掉的孤儿工具结果 id。
 *
 * pi 组装请求时会整条丢弃 stopReason 为 error/aborted 的 assistant 消息，
 * 但它发起的工具结果照样保留 —— 上游于是收到一条没有前置 tool_calls 的
 * tool 消息并拒绝整段历史。历史只能追加，只能靠 context_edit 把它摘掉。
 */
export function orphanToolResultEntryIds(
	entries: readonly SessionEntryLike[],
): string[] {
	const removed = new Set<string>();
	const abandonedCalls = new Set<string>();
	for (const entry of entries) {
		if (entry.type === "context_edit" && entry.replacement === null) {
			if (typeof entry.targetId === "string") removed.add(entry.targetId);
			continue;
		}
		const message = entry.message;
		if (!message || message.role !== "assistant") continue;
		if (message.stopReason !== "aborted" && message.stopReason !== "error") {
			continue;
		}
		if (!Array.isArray(message.content)) continue;
		for (const part of message.content) {
			const call = part as { type?: unknown; id?: unknown } | null;
			if (call?.type === "toolCall" && typeof call.id === "string" && call.id) {
				abandonedCalls.add(call.id);
			}
		}
	}
	if (!abandonedCalls.size) return [];
	const orphans: string[] = [];
	for (const entry of entries) {
		const message = entry.message;
		if (!message || message.role !== "toolResult") continue;
		const callId = message.toolCallId;
		if (typeof callId !== "string" || !abandonedCalls.has(callId)) continue;
		if (removed.has(entry.id)) continue;
		orphans.push(entry.id);
	}
	return orphans;
}

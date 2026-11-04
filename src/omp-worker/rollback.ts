import type { AgentSession } from "@oh-my-pi/pi-coding-agent";
import { messageContentText, turnTextMatches } from "../shared/turn-match";

/**
 * OMP 的回退（放弃某一轮 / 回退到某一轮结束）。
 *
 * OMP 的会话树接口与 pi 对齐（getBranch / getEntry / getLeafId / navigateTree），
 * 所以回退逻辑照 pi 的做法走，但独立实现，不共享 pi 的 worker 代码。
 */

/** 当前分支（root → leaf）上的 user 轮次 entry id。 */
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
 *
 * `userIndex` 为当前分支上 user 消息的 0 基下标；`expectText` 用于确认该下标
 * 仍指向界面上的那一轮，避免界面与分支不同步时回退到别的轮次。
 */
export async function rollbackOmpUserTurn(
	active: AgentSession,
	userIndex?: number,
	expectText?: string,
): Promise<boolean> {
	const entryIds = branchUserEntryIds(active);
	if (!entryIds.length) return false;
	const idx = userIndex == null ? entryIds.length - 1 : userIndex;
	// 越界说明该气泡从未进入会话树（例如 prompt 前就被拒绝），不要顺延。
	if (idx < 0 || idx >= entryIds.length) return false;
	const target = entryIds[idx];
	if (!target) return false;
	if (expectText && !turnTextMatches(userEntryText(active, target), expectText)) {
		return false;
	}
	await active.navigateTree(target, { summarize: false });
	try {
		active.sessionManager.appendCustomEntry("desktop-turn-rollback", {
			rolledBackEntryId: target,
		});
	} catch {
		// 标记失败不影响回退本身
	}
	return true;
}

/**
 * 回退到某一轮结束：保留该轮问答，丢弃其后所有轮次。
 *
 * `userIndex` 为当前分支上 user 消息的 0 基下标；`expectText` 用于确认该下标
 * 仍指向界面上的那一轮。
 */
export async function rollbackOmpTurnEnd(
	active: AgentSession,
	userIndex?: number,
	expectText?: string,
): Promise<boolean> {
	const branch = active.sessionManager.getBranch();
	const userIds = branch
		.filter((entry) => entry.type === "message" && entry.message.role === "user")
		.map((entry) => entry.id);
	if (!userIds.length) return false;
	const idx = userIndex == null ? userIds.length - 1 : userIndex;
	if (idx < 0 || idx >= userIds.length) return false;
	const target = userIds[idx];
	if (!target) return false;
	if (expectText && !turnTextMatches(userEntryText(active, target), expectText)) {
		return false;
	}
	const nextUserId = userIds[idx + 1];
	const nextIdx = nextUserId ? branch.findIndex((entry) => entry.id === nextUserId) : -1;
	const endIdx = nextIdx === -1 ? branch.length : nextIdx;
	const startIdx = branch.findIndex((entry) => entry.id === target);
	let leafId = target;
	for (let i = startIdx + 1; i < endIdx; i++) {
		const entry = branch[i];
		if (entry?.type === "message") leafId = entry.id;
	}
	if (leafId === active.sessionManager.getLeafId()) return true;
	await active.navigateTree(leafId, { summarize: false });
	try {
		active.sessionManager.appendCustomEntry("desktop-turn-rollback", {
			rolledBackEntryId: leafId,
		});
	} catch {
		// 标记失败不影响回退本身
	}
	return true;
}

/**
 * 回退后补齐被中断的工具调用结果。
 *
 * stop 落在工具执行中时，assistant 的 tool_call 照样落盘而工具结果不会写出：
 * 会话树从此断链。补一条取消结果让链路闭合。
 */
export function fillOmpCancelledToolResults(active: AgentSession): void {
	const branch = active.sessionManager.getBranch();
	const answered = new Set<string>();
	for (const entry of branch) {
		if (entry.type !== "message" || entry.message.role !== "toolResult") continue;
		const callId = (entry.message as { toolCallId?: unknown }).toolCallId;
		if (typeof callId === "string" && callId) answered.add(callId);
	}
	for (const entry of branch) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const assistant = entry.message as {
			stopReason?: unknown;
			content?: unknown;
		};
		// 中断/失败的 assistant 会被整条丢弃：补结果只会造出孤儿 tool 消息。
		if (assistant.stopReason === "aborted" || assistant.stopReason === "error") {
			continue;
		}
		const content = assistant.content;
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			const call = part as { type?: unknown; id?: unknown; name?: unknown };
			if (call.type !== "toolCall" || typeof call.id !== "string" || !call.id) continue;
			if (answered.has(call.id)) continue;
			answered.add(call.id);
			active.sessionManager.appendMessage({
				role: "toolResult",
				toolCallId: call.id,
				toolName: typeof call.name === "string" && call.name ? call.name : "tool",
				content: [{ type: "text", text: CANCELLED_TOOL_RESULT }],
				isError: true,
				timestamp: Date.now(),
			});
		}
	}
}

/** 中断的工具调用在界面上显示的文案。 */
const CANCELLED_TOOL_RESULT = "Cancelled by user";

import { existsSync } from "node:fs";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { SessionForkResult } from "../shared/protocol";
import { stripAttachedImagesBlock } from "../shared/chat-meta";
import { stripComposerModePreamble } from "../shared/composer-modes";
import { messageContentText, turnTextMatches } from "../shared/turn-match";

const FORK_TITLE_PREFIX = "Forked: ";
const FORK_TITLE_MAX = 60;

/** 当前 leaf 分支上的 user 消息 entry id，按 root → leaf 顺序。 */
function userEntryIdsOnBranch(path: SessionEntry[]): string[] {
	return path
		.filter((entry) => entry.type === "message" && entry.message.role === "user")
		.map((entry) => entry.id);
}

/** 分支上第一条 user 消息的正文，用作无名字会话的标题。 */
function firstUserText(path: SessionEntry[]): string {
	for (const entry of path) {
		if (entry.type !== "message" || entry.message.role !== "user") continue;
		const raw = messageContentText((entry.message as { content?: unknown }).content);
		const clean = stripComposerModePreamble(stripAttachedImagesBlock(raw))
			.replace(/\s+/g, " ")
			.trim();
		if (clean) return clean;
	}
	return "";
}

/** 派生会话标题：取分叉点消息文本，为空时回退为 `Forked: ` + 源会话名。 */
function forkTitleFor(turnText: string, sourceName: string | null): string | null {
	const clean = stripComposerModePreamble(stripAttachedImagesBlock(turnText))
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, FORK_TITLE_MAX);
	if (clean) return clean;
	if (!sourceName) return null;
	const src = sourceName.replace(/\s+/g, " ").trim().slice(0, FORK_TITLE_MAX);
	return src ? `${FORK_TITLE_PREFIX}${src}` : null;
}

/**
 * 把到某一轮结束（本轮提问 + 本轮回复）为止的对话复制成一个新会话文件。
 * 源会话不变，新会话 header 以源文件作为 parentSession。
 * `expectText` 用于确认该下标仍指向界面上的那一轮，避免复制错轮次。
 */
export async function forkSessionAtUserTurn(
	filePath: string,
	userIndex: number,
	expectText?: string,
): Promise<SessionForkResult> {
	const source = filePath.trim();
	if (!source || !existsSync(source)) {
		throw new Error("session file not found");
	}
	const { SessionManager } = await import("@earendil-works/pi-coding-agent");
	const manager = SessionManager.open(source);
	const branch = manager.getBranch();
	const userIds = userEntryIdsOnBranch(branch);
	const targetId = userIds[userIndex];
	if (!targetId) {
		throw new Error(`fork target turn not found: ${userIndex}`);
	}
	const target = branch.find((entry) => entry.id === targetId);
	const targetText =
		target && target.type === "message"
			? messageContentText((target.message as { content?: unknown }).content)
			: "";
	if (expectText && !turnTextMatches(targetText, expectText)) {
		throw new Error("this turn no longer matches the conversation — reopen the session and retry");
	}
	// 本轮范围 = 该 user entry 到下一个 user entry 之前，leaf 取本轮最后一条 entry，
	// 新会话因此包含本轮的提问与回复。
	const nextUserId = userIds[userIndex + 1];
	const nextIdx = nextUserId
		? branch.findIndex((entry) => entry.id === nextUserId)
		: -1;
	const leafId = branch[(nextIdx === -1 ? branch.length : nextIdx) - 1]?.id;
	if (!leafId) {
		throw new Error(`fork target turn not found: ${userIndex}`);
	}
	const sourceName = manager.getSessionName() ?? firstUserText(branch);
	const forkTitle = forkTitleFor(targetText, sourceName || null);
	const forkedFile = manager.createBranchedSession(leafId);
	if (!forkedFile || !existsSync(forkedFile)) {
		throw new Error("could not write the forked session");
	}
	if (forkTitle) {
		manager.appendSessionInfo(forkTitle);
	}
	return {
		id: manager.getSessionId(),
		filePath: forkedFile,
		cwd: manager.getCwd(),
	};
}

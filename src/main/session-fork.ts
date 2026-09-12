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

/** 派生会话标题：始终带 `Forked: ` 前缀，派生自派生时不重复叠加。 */
function forkTitleFor(title: string): string | null {
	const clean = title.replace(/\s+/g, " ").trim().slice(0, FORK_TITLE_MAX);
	if (!clean) return null;
	return clean.startsWith(FORK_TITLE_PREFIX)
		? clean
		: `${FORK_TITLE_PREFIX}${clean}`;
}

/**
 * 把某一轮 user 消息**之前**的对话复制成一个新会话文件（与界面上的分隔线一致：
 * 还原检查点也是在这条线上截断）。源会话不变，新会话 header 以源文件作为 parentSession。
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
	// 第一轮之前没有可继承的历史，Copilot 同样不在第一轮提供派生。
	if (userIndex <= 0) {
		throw new Error("cannot fork before the first turn — pick a later turn");
	}
	const { SessionManager } = await import("@earendil-works/pi-coding-agent");
	const manager = SessionManager.open(source);
	const branch = manager.getBranch();
	const targetId = userEntryIdsOnBranch(branch)[userIndex];
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
	const leafId = target?.parentId;
	if (!leafId) {
		throw new Error("nothing to fork before this turn");
	}
	const sourceName = manager.getSessionName() ?? firstUserText(branch);
	const forkTitle = forkTitleFor(sourceName);
	const forkedFile = manager.createBranchedSession(leafId);
	if (!forkedFile || !existsSync(forkedFile)) {
		throw new Error("the turn before this one has no reply yet — nothing to fork");
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

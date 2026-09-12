import { existsSync } from "node:fs";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { SessionForkResult } from "../shared/protocol";

/** 当前 leaf 分支上的 user 消息 entry id，按 root → leaf 顺序。 */
function userEntryIdsOnBranch(path: SessionEntry[]): string[] {
	return path
		.filter((entry) => entry.type === "message" && entry.message.role === "user")
		.map((entry) => entry.id);
}

/** 该轮在分支上的最后一个 entry（到下一条 user 消息为止），无产物时为 null。 */
function turnEndEntryId(path: SessionEntry[], userEntryId: string): string | null {
	const start = path.findIndex((entry) => entry.id === userEntryId);
	let leafId: string | null = null;
	for (let i = start + 1; i < path.length; i++) {
		const entry = path[i];
		if (!entry) break;
		if (entry.type === "message" && entry.message.role === "user") break;
		leafId = entry.id;
	}
	return leafId;
}

/**
 * 把到第 userIndex 轮 user 消息为止的对话复制成一个新会话文件；
 * 源会话不变，新会话 header 以源文件作为 parentSession。
 */
export async function forkSessionAtUserTurn(
	filePath: string,
	userIndex: number,
): Promise<SessionForkResult> {
	const source = filePath.trim();
	if (!source || !existsSync(source)) {
		throw new Error("session file not found");
	}
	const { SessionManager } = await import("@earendil-works/pi-coding-agent");
	const manager = SessionManager.open(source);
	const branch = manager.getBranch();
	const targetId = userEntryIdsOnBranch(branch)[userIndex];
	if (!targetId) {
		throw new Error(`fork target turn not found: ${userIndex}`);
	}
	const leafId = turnEndEntryId(branch, targetId);
	if (!leafId) {
		throw new Error("this turn has no response yet — nothing to fork");
	}
	const sourceName = manager.getSessionName();
	const forkedFile = manager.createBranchedSession(leafId);
	if (!forkedFile || !existsSync(forkedFile)) {
		throw new Error("failed to write the forked session");
	}
	if (sourceName) {
		manager.appendSessionInfo(`Forked: ${sourceName}`);
	}
	return {
		id: manager.getSessionId(),
		filePath: forkedFile,
		cwd: manager.getCwd(),
	};
}

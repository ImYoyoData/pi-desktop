import { copyFileSync, existsSync } from "node:fs";
import { SessionManager } from "@oh-my-pi/pi-coding-agent";
import { chatMetaPath } from "../shared/chat-meta";
import { messageContentText, turnTextMatches } from "../shared/turn-match";
import { forkTitleFor } from "../shared/session-fork-title";
import type { SessionForkResult } from "../shared/protocol";

/**
 * OMP 的「编辑某轮后重发」：把到该轮结束为止的对话复制成新会话。
 *
 * 必须用 OMP 自己的 SessionManager：pi 的 SDK 会拒绝这种文件（首行是 omp 的
 * title slot，header 也带 omp 自己的字段）。这里为 fork 单独打开一份管理器，
 * 不动正在运行的那个会话。
 */
export async function forkOmpUserTurn(
	sessionFile: string,
	userIndex: number,
	expectText?: string,
): Promise<SessionForkResult> {
	const source = sessionFile.trim();
	if (!source) throw new Error("session file not found");
	const manager = await SessionManager.open(source, undefined, undefined, {
		throwIfMissing: true,
	});
	const branch = manager.getBranch();
	const userIds = branch
		.filter((entry) => entry.type === "message" && entry.message.role === "user")
		.map((entry) => entry.id);
	const targetId = userIds[userIndex];
	if (!targetId) throw new Error(`fork target turn not found: ${userIndex}`);
	const target = branch.find((entry) => entry.id === targetId);
	const targetText =
		target && target.type === "message"
			? messageContentText((target.message as { content?: unknown }).content)
			: "";
	if (expectText && !turnTextMatches(targetText, expectText)) {
		throw new Error("this turn no longer matches the conversation — reopen the session and retry");
	}
	// 本轮范围 = 该 user entry 到下一个 user entry 之前：新会话包含本轮问答。
	const nextUserId = userIds[userIndex + 1];
	const nextIdx = nextUserId
		? branch.findIndex((entry) => entry.id === nextUserId)
		: -1;
	const leafId = branch[(nextIdx === -1 ? branch.length : nextIdx) - 1]?.id;
	if (!leafId) throw new Error(`fork target turn not found: ${userIndex}`);

	const title = forkTitleFor(targetText, manager.getSessionName() ?? null);
	const forkedFile = manager.createBranchedSession(leafId);
	if (!forkedFile) throw new Error("could not write the forked session");
	if (title) await manager.setSessionName(title, "user");
	const sourceMeta = chatMetaPath(source);
	if (existsSync(sourceMeta)) {
		try {
			copyFileSync(sourceMeta, chatMetaPath(forkedFile));
		} catch {
			// sidecar 是展示增强，复制失败不影响分叉。
		}
	}
	return {
		id: manager.getSessionId(),
		filePath: forkedFile,
		cwd: manager.getCwd(),
	};
}

import { create } from "zustand";

export type CheckpointSummary = {
	sessionId: string;
	userMessageId: string;
	status: "capturing" | "ready" | "reverted" | "empty";
	fileCount: number;
	skippedCount: number;
};

type CheckpointRevertResult = {
	ok: boolean;
	restored: number;
	deleted: number;
	skipped: number;
	error: string | null;
};

type CheckpointState = {
	byKey: Record<string, CheckpointSummary>;
	bindEvents: () => () => void;
	begin: (sessionId: string, userMessageId: string) => Promise<void>;
	finishActive: (sessionId: string) => Promise<void>;
	loadSessionSummaries: (sessionId: string) => Promise<void>;
	canRevert: (sessionId: string, userMessageId: string) => boolean;
	isReverted: (sessionId: string, userMessageId: string) => boolean;
	summaryFor: (
		sessionId: string,
		userMessageId: string,
	) => CheckpointSummary | null;
	revert: (
		sessionId: string,
		userMessageId: string,
	) => Promise<CheckpointRevertResult>;
	clearSession: (sessionId: string) => void;
};

function keyOf(sessionId: string, userMessageId: string): string {
	return `${sessionId}::${userMessageId}`;
}

export const useCheckpointStore = create<CheckpointState>()((set, get) => {
	let unbind: (() => void) | null = null;

	function putSummary(summary: CheckpointSummary): void {
		set((state) => ({
			byKey: {
				...state.byKey,
				[keyOf(summary.sessionId, summary.userMessageId)]: summary,
			},
		}));
	}

	/**
	 * 注册检查点更新订阅，返回解绑函数（重复调用返回同一个）。
	 * 由应用级 bootstrap 持有：检查点事件同样是单向推送，不能随面板卸载。
	 */
	function bindEvents(): () => void {
		if (unbind) return unbind;
		const off = window.api.checkpoint.onUpdated((summary) => {
			putSummary(summary);
		});
		unbind = () => {
			unbind = null;
			off();
		};
		return unbind;
	}

	async function begin(
		sessionId: string,
		userMessageId: string,
	): Promise<void> {
		const summary = await window.api.checkpoint.begin(sessionId, userMessageId);
		putSummary(summary);
	}

	async function finishActive(sessionId: string): Promise<void> {
		const summary = await window.api.checkpoint.finishActive(sessionId);
		if (summary) {
			putSummary(summary);
		}
	}

	/** Restore persisted summaries for a session (history revert buttons). */
	async function loadSessionSummaries(sessionId: string): Promise<void> {
		try {
			const rows = await window.api.checkpoint.list(sessionId);
			for (const s of rows) {
				putSummary(s);
			}
		} catch {
			// best-effort — buttons degrade gracefully
		}
	}

	function canRevert(sessionId: string, userMessageId: string): boolean {
		const s = get().byKey[keyOf(sessionId, userMessageId)];
		return s?.status === "ready" && s.fileCount > 0;
	}

	function isReverted(sessionId: string, userMessageId: string): boolean {
		return get().byKey[keyOf(sessionId, userMessageId)]?.status === "reverted";
	}

	/** Expose summary so templates can depend on byKey reactively. */
	function summaryFor(
		sessionId: string,
		userMessageId: string,
	): CheckpointSummary | null {
		return get().byKey[keyOf(sessionId, userMessageId)] ?? null;
	}

	async function revert(
		sessionId: string,
		userMessageId: string,
	): Promise<CheckpointRevertResult> {
		const result = await window.api.checkpoint.revert(sessionId, userMessageId);
		const summary = await window.api.checkpoint.get(sessionId, userMessageId);
		if (summary) putSummary(summary);
		return result;
	}

	/** 丢弃某会话的全部检查点记录（key 形如 `sessionId::userMessageId`）。 */
	function clearSession(sessionId: string): void {
		const prefix = `${sessionId}::`;
		const next: Record<string, CheckpointSummary> = {};
		for (const [key, value] of Object.entries(get().byKey)) {
			if (key.startsWith(prefix)) continue;
			next[key] = value;
		}
		set({ byKey: next });
	}

	return {
		byKey: {},
		bindEvents,
		begin,
		finishActive,
		loadSessionSummaries,
		canRevert,
		isReverted,
		summaryFor,
		revert,
		clearSession,
	};
});

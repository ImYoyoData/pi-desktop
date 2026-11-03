import type {
	ExtensionApprovalAnswer,
	ExtensionUIContext,
} from "@oh-my-pi/pi-coding-agent";
import {
	EXTENSION_UI_TIMEOUT_MS,
	extensionUiReplyResult,
	type ExtensionUiDialogMethod,
	type ExtensionUiReply,
} from "../shared/extension-ui";
import { rpcToMain } from "./main-rpc";

/**
 * 桌面 ExtensionUIContext：扩展的对话框、通知与工具审批都转到渲染层。
 *
 * 协议与 pi 侧共用（渲染层是同一套卡片），但桥接实现独立：OMP 的 worker 走
 * 自己的 RPC 通道。
 */
export type OmpExtensionUiDeps = {
	/** 替换默认的 RPC 通道（测试用）。 */
	rpc?: (
		method: string,
		params: Record<string, unknown>,
		timeoutMs: number | null,
	) => Promise<unknown>;
};

const APPROVE_ONCE = "Approve this call";
const APPROVE_DENY = "Deny";

function asReply(raw: unknown): ExtensionUiReply {
	if (!raw || typeof raw !== "object") {
		return { requestId: "", cancelled: true };
	}
	const row = raw as Record<string, unknown>;
	const requestId = typeof row.requestId === "string" ? row.requestId : "";
	if (row.cancelled === true) return { requestId, cancelled: true };
	if (row.back === true) return { requestId, back: true };
	if (typeof row.confirmed === "boolean") {
		return { requestId, confirmed: row.confirmed };
	}
	if (typeof row.value === "string") {
		return { requestId, value: row.value };
	}
	return { requestId, cancelled: true };
}

let rewindRequested = false;

export function takeExtensionUiRewind(): boolean {
	const requested = rewindRequested;
	rewindRequested = false;
	return requested;
}

/**
 * 工具审批：把 OMP 的审批提示交给桌面卡片。
 *
 * OMP 自己的 tools.approvalMode 决定何时需要询问，桌面只负责展示与回答，
 * 与 pi 的权限档位是两套独立设置。未明确的回答一律按拒绝处理；提示里带了
 * 「本会话允许」的文案时，用选择卡片把这一档一并给出。
 */
function approvalChoices(session: string | undefined): string[] {
	return session
		? [APPROVE_ONCE, session, APPROVE_DENY]
		: [APPROVE_ONCE, APPROVE_DENY];
}

function answerOf(choice: string | boolean | undefined, session?: string): ExtensionApprovalAnswer {
	if (choice === APPROVE_ONCE) return "once";
	if (session && choice === session) return "session";
	return "deny";
}

/** 桌面端扩展 UI 上下文：对话框 + 通知 + 工具审批。 */
export function createOmpDesktopExtensionUIContext(
	deps: OmpExtensionUiDeps = {},
): ExtensionUIContext {
	const rpc = deps.rpc ?? ((method, params, timeoutMs) => rpcToMain(method, params, timeoutMs));

	async function askDialog(
		method: ExtensionUiDialogMethod,
		params: Record<string, unknown>,
		timeoutMs?: number,
	): Promise<string | boolean | undefined> {
		const ms =
			typeof timeoutMs === "number" && timeoutMs > 0
				? timeoutMs
				: EXTENSION_UI_TIMEOUT_MS;
		try {
			const raw = await rpc("desktop.extensionUi", { method, ...params }, ms);
			const reply = asReply(raw);
			if ("back" in reply && reply.back === true) {
				if (method === "editor") rewindRequested = true;
				return undefined;
			}
			return extensionUiReplyResult(method, reply);
		} catch {
			return extensionUiReplyResult(method, { requestId: "", cancelled: true });
		}
	}

	function fireAndForget(method: string, params: Record<string, unknown>): void {
		void rpc("desktop.extensionUi", { method, ...params }, 15_000).catch(() => {
			// 通知类请求失败不影响会话。
		});
	}

	async function approveTool(
		prompt: { full: string; compact: string; session?: string },
		timeoutMs?: number,
	): Promise<ExtensionApprovalAnswer> {
		const title = prompt.compact.split("\n")[0] ?? "Approve tool call";
		const choice = await askDialog(
			"select",
			{
				title,
				options: approvalChoices(prompt.session),
				message: prompt.full,
			},
			timeoutMs,
		);
		return answerOf(
			typeof choice === "string" ? choice : undefined,
			prompt.session,
		);
	}

	return {
		approve: (prompt, opts) => approveTool(prompt, opts?.timeout),
		select: async (title, options, opts) => {
			const result = await askDialog(
				"select",
				{
					title,
					options: options.map((option) =>
						typeof option === "string" ? option : option.label,
					),
				},
				opts?.timeout,
			);
			return typeof result === "string" ? result : undefined;
		},
		confirm: async (title, message, opts) => {
			const result = await askDialog(
				"confirm",
				{ title, message },
				opts?.timeout,
			);
			return result === true;
		},
		input: async (title, placeholder, opts) => {
			const result = await askDialog(
				"input",
				{ title, ...(placeholder != null ? { placeholder } : {}) },
				opts?.timeout,
			);
			return typeof result === "string" ? result : undefined;
		},
		editor: async (title, prefill, opts) => {
			const result = await askDialog(
				"editor",
				{ title, ...(prefill != null ? { prefill } : {}) },
				opts?.timeout,
			);
			return typeof result === "string" ? result : undefined;
		},
		notify: (message, type) => {
			fireAndForget("notify", {
				message,
				notifyType: type ?? "info",
			});
		},
		onTerminalInput: () => () => {},
		getLinkClicksAvailable: () => false,
		setStatus: () => {},
	} as unknown as ExtensionUIContext;
}

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
 * 桌面 ExtensionUIContext：扩展的对话框与通知转发到渲染层。
 *
 * 协议与 pi 侧共用（渲染层是同一套卡片），但桥接实现独立：OMP 的 worker 走
 * 自己的 RPC 通道。
 */

function asReply(raw: unknown): ExtensionUiReply {
	if (!raw || typeof raw !== "object") {
		return { requestId: "", cancelled: true };
	}
	const row = raw as Record<string, unknown>;
	const requestId = typeof row.requestId === "string" ? row.requestId : "";
	if (row.cancelled === true) return { requestId, cancelled: true };
	if (typeof row.confirmed === "boolean") {
		return { requestId, confirmed: row.confirmed };
	}
	if (typeof row.value === "string") {
		return { requestId, value: row.value };
	}
	return { requestId, cancelled: true };
}

async function askDialog(
	method: ExtensionUiDialogMethod,
	params: Record<string, unknown>,
	timeoutMs?: number,
): Promise<string | boolean | undefined> {
	const ms =
		typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : EXTENSION_UI_TIMEOUT_MS;
	try {
		const raw = await rpcToMain(
			"desktop.extensionUi",
			{ method, ...params },
			ms,
		);
		return extensionUiReplyResult(method, asReply(raw));
	} catch {
		return extensionUiReplyResult(method, { requestId: "", cancelled: true });
	}
}

function fireAndForget(method: string, params: Record<string, unknown>): void {
	void rpcToMain("desktop.extensionUi", { method, ...params }, 15_000).catch(() => {
		// 通知类请求失败不影响会话。
	});
}

/**
 * 工具审批：把 OMP 的审批提示交给桌面确认卡片。
 *
 * OMP 自己的 tools.approvalMode 决定何时需要询问，桌面只负责展示与回答，
 * 与 pi 的权限档位是两套独立设置。未明确的回答一律按拒绝处理。
 */
async function approveTool(
	prompt: { full: string; compact: string; session?: string },
	timeoutMs?: number,
): Promise<ExtensionApprovalAnswer> {
	const result = await askDialog(
		"confirm",
		{
			title: prompt.compact.split("\n")[0] ?? "Approve tool call",
			message: prompt.full,
		},
		timeoutMs,
	);
	return result === true ? "once" : "deny";
}

/** 桌面端扩展 UI 上下文：对话框 + 通知 + 工具审批。 */
export function createOmpDesktopExtensionUIContext(): ExtensionUIContext {
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

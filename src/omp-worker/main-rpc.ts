import { randomUUID } from "node:crypto";
import type {
	OmpWorkerInbound,
	OmpWorkerOutbound,
} from "../shared/omp-worker-messages";
import { post } from "./transport";

type Pending = {
	resolve: (value: unknown) => void;
	reject: (err: Error) => void;
	timer: ReturnType<typeof setTimeout> | null;
};

const pending = new Map<string, Pending>();
let workspaceRoot: string | null = null;

export function setRpcWorkspaceRoot(cwd: string | null): void {
	workspaceRoot = cwd;
}

/** 主进程回送 RPC 结果。 */
export function handleOmpRpcResponse(
	msg: Extract<OmpWorkerInbound, { kind: "rpc_response" }>,
): void {
	const row = pending.get(msg.id);
	if (!row) return;
	pending.delete(msg.id);
	if (row.timer) clearTimeout(row.timer);
	if (msg.error) row.reject(new Error(msg.error));
	else row.resolve(msg.result);
}

/**
 * 调用主进程并等待结果。
 *
 * `timeoutMs: null` 表示不设自动超时（提问会一直等到用户回答或回合被中止）。
 * signal 中止时通知主进程撤掉挂起的 UI 提问，再让本地 promise 失败。
 */
export function rpcToMain(
	method: string,
	params: Record<string, unknown> = {},
	timeoutMs: number | null = null,
	signal?: AbortSignal,
): Promise<unknown> {
	const id = randomUUID();
	return new Promise((resolve, reject) => {
		const cleanup = (): void => {
			pending.delete(id);
			signal?.removeEventListener("abort", onAbort);
		};
		const onAbort = (): void => {
			if (rowTimer) clearTimeout(rowTimer);
			cleanup();
			const cancel: OmpWorkerOutbound = {
				kind: "rpc_request",
				id: randomUUID(),
				method: "desktop.rpcCancel",
				params: { requestId: id },
			};
			post(cancel);
			reject(new Error(`rpc cancelled: ${method}`));
		};
		let rowTimer: ReturnType<typeof setTimeout> | null = null;
		if (typeof timeoutMs === "number" && timeoutMs > 0) {
			rowTimer = setTimeout(() => {
				cleanup();
				reject(new Error(`rpc timeout: ${method}`));
			}, timeoutMs);
		}
		if (signal) {
			if (signal.aborted) {
				if (rowTimer) clearTimeout(rowTimer);
				reject(new Error(`rpc cancelled: ${method}`));
				return;
			}
			signal.addEventListener("abort", onAbort, { once: true });
		}
		pending.set(id, { resolve, reject, timer: rowTimer });
		post({
			kind: "rpc_request",
			id,
			method,
			params: {
				...params,
				workspaceRoot:
					typeof params.workspaceRoot === "string"
						? params.workspaceRoot
						: workspaceRoot,
			},
		});
	});
}

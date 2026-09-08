import { randomUUID } from "node:crypto";
import type { WorkerInbound, WorkerOutbound } from "../shared/agent-worker-messages";
import {
  BROWSER_RPC_TIMEOUT_MS,
  type BrowserRpcMethod,
} from "../shared/browser-automation";
import { PERMISSION_ASK_TIMEOUT_MS } from "../shared/desktop-security";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

const pending = new Map<string, Pending>();
let workspaceRoot: string | null = null;

/** Default RPC timeout; permission asks use {@link PERMISSION_ASK_TIMEOUT_MS}. */
export { PERMISSION_ASK_TIMEOUT_MS };

function post(msg: WorkerOutbound): void {
  process.parentPort?.postMessage(msg);
}

export function setRpcWorkspaceRoot(cwd: string | null): void {
  workspaceRoot = cwd;
}

export function handleRpcResponse(msg: Extract<WorkerInbound, { kind: "rpc_response" }>): void {
  const row = pending.get(msg.id);
  if (!row) return;
  pending.delete(msg.id);
  if (row.timer) clearTimeout(row.timer);
  if (msg.error) row.reject(new Error(msg.error));
  else row.resolve(msg.result);
}

/**
 * Call a method in the main process and await the result.
 *
 * When `signal` aborts (agent Stop / turn teardown) the pending UI ask is
 * cancelled: main is told to drop its pending request and broadcast a cancel
 * to the renderer so the strip closes, then the local promise rejects.
 *
 * `timeoutMs: null` disables the auto-timeout — the ask waits until the user
 * answers or the turn is aborted. NOTE: pass `null`, not `undefined` —
 * an explicit `undefined` is replaced by the default (BROWSER_RPC_TIMEOUT_MS)
 * per JS default-parameter semantics.
 */
export function rpcToMain(
  method: BrowserRpcMethod | string,
  params: Record<string, unknown> = {},
  timeoutMs: number | null = BROWSER_RPC_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<unknown> {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      pending.delete(id);
      if (signal) signal.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      if (rowTimer) clearTimeout(rowTimer);
      cleanup();
      console.warn(`[ask-user-diag] rpcToMain abort fired for method=${method} id=${id}`);
      // Tell main to tear down the pending UI ask (broadcasts a cancel so the
      // renderer strip closes). The reply to this cancel is intentionally ignored.
      post({
        kind: "rpc_request",
        id: randomUUID(),
        method: "desktop.rpcCancel",
        params: { requestId: id },
      });
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

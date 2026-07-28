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
  timer: ReturnType<typeof setTimeout>;
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
  clearTimeout(row.timer);
  if (msg.error) row.reject(new Error(msg.error));
  else row.resolve(msg.result);
}

export function rpcToMain(
  method: BrowserRpcMethod | string,
  params: Record<string, unknown> = {},
  timeoutMs = BROWSER_RPC_TIMEOUT_MS,
): Promise<unknown> {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`rpc timeout: ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
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

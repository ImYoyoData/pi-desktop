import { BrowserWindow, ipcMain } from "electron";
import {
  bashAllowlistEntryFromCommand,
  isPermissionDecision,
  PERMISSION_ASK_TIMEOUT_MS,
  type PermissionAskReply,
  type PermissionAskRequest,
  type PermissionDecision,
  type SecurityCategory,
} from "../shared/desktop-security";
import { IpcChannels } from "../shared/protocol";
import { appendBashAllowlistEntry } from "./desktop-security-host";
import type { SessionBroker } from "./session-broker";

type PendingAsk = {
  sessionId: string;
  category: SecurityCategory;
  summary: string;
  resolve: (decision: PermissionDecision) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pendingAsks = new Map<string, PendingAsk>();
let securityBroker: SessionBroker | undefined;

function broadcastPermission(payload: PermissionAskRequest): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.sessions.permission, payload);
  }
}

function broadcastCancelled(sessionId: string, requestId: string): void {
  broadcastPermission({ sessionId, requestId, cancelled: true });
}

/**
 * Ask the renderer PermissionStrip for a decision.
 * Resolves with the user decision, or rejects on timeout / no UI.
 */
export function askRendererPermission(input: {
  sessionId: string;
  requestId: string;
  category: SecurityCategory;
  toolName: string;
  summary: string;
  timeoutMs?: number;
}): Promise<PermissionDecision> {
  const timeoutMs = input.timeoutMs ?? PERMISSION_ASK_TIMEOUT_MS;
  const { requestId, sessionId } = input;

  return new Promise((resolve, reject) => {
    if (BrowserWindow.getAllWindows().length === 0) {
      reject(new Error("permission UI unavailable"));
      return;
    }

    if (pendingAsks.has(requestId)) {
      reject(new Error(`duplicate permission request: ${requestId}`));
      return;
    }

    const timer = setTimeout(() => {
      pendingAsks.delete(requestId);
      broadcastCancelled(sessionId, requestId);
      reject(new Error("permission prompt timed out"));
    }, timeoutMs);

    pendingAsks.set(requestId, {
      sessionId,
      category: input.category,
      summary: input.summary,
      resolve,
      reject,
      timer,
    });
    broadcastPermission({
      sessionId,
      requestId,
      category: input.category,
      toolName: input.toolName,
      summary: input.summary,
    });
  });
}

export function registerPermissionAskIpc(broker?: SessionBroker): void {
  securityBroker = broker;
  ipcMain.handle(
    IpcChannels.sessions.permissionReply,
    async (_event, body: PermissionAskReply) => {
      if (!body || typeof body !== "object") {
        throw new Error("permissionReply: body required");
      }
      const requestId = typeof body.requestId === "string" ? body.requestId : "";
      if (!requestId) {
        throw new Error("permissionReply: requestId required");
      }
      const row = pendingAsks.get(requestId);
      if (!row) {
        return { ok: false, reason: "unknown_or_expired" as const };
      }
      pendingAsks.delete(requestId);
      clearTimeout(row.timer);
      if (!isPermissionDecision(body.decision)) {
        row.resolve("deny");
        return { ok: true };
      }

      let decision = body.decision;
      if (decision === "allow_whitelist") {
        if (row.category === "bash") {
          const entry = bashAllowlistEntryFromCommand(row.summary);
          if (entry) {
            const next = await appendBashAllowlistEntry(entry);
            await securityBroker?.notifyWorkersReloadSecurity(next);
          }
        }
        // Still allow this invocation even if category wasn't bash.
        decision = "allow_whitelist";
      }

      row.resolve(decision);
      return { ok: true };
    },
  );
}

/** Test / shutdown helper: reject all outstanding asks. */
export function clearPendingPermissionAsks(reason = "permission asks cleared"): void {
  for (const [id, row] of pendingAsks) {
    clearTimeout(row.timer);
    broadcastCancelled(row.sessionId, id);
    row.reject(new Error(reason));
    pendingAsks.delete(id);
  }
}

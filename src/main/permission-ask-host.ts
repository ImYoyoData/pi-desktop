import { BrowserWindow, ipcMain } from "electron";
import {
  isPermissionDecision,
  PERMISSION_ASK_TIMEOUT_MS,
  type PermissionAskPrompt,
  type PermissionAskReply,
  type PermissionAskRequest,
  type PermissionDecision,
  type SecurityCategory,
} from "../shared/desktop-security";
import { IpcChannels } from "../shared/protocol";

type PendingAsk = {
  sessionId: string;
  category: SecurityCategory;
  toolName: string;
  summary: string;
  danger: boolean;
  resolve: (decision: PermissionDecision) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pendingAsks = new Map<string, PendingAsk>();

/** Re-send every outstanding permission ask to a freshly loaded renderer. */
export function snapshotPendingPermissionAsks(): PermissionAskPrompt[] {
  const out: PermissionAskPrompt[] = [];
  for (const [requestId, row] of pendingAsks) {
    const prompt: PermissionAskPrompt = {
      sessionId: row.sessionId,
      requestId,
      category: row.category,
      toolName: row.toolName,
      summary: row.summary,
    };
    if (row.danger) prompt.danger = true;
    out.push(prompt);
  }
  return out;
}

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
  danger?: boolean;
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
      toolName: input.toolName,
      summary: input.summary,
      danger: input.danger === true,
      resolve,
      reject,
      timer,
    });
    const prompt: PermissionAskPrompt = {
      sessionId,
      requestId,
      category: input.category,
      toolName: input.toolName,
      summary: input.summary,
    };
    if (input.danger) prompt.danger = true;
    broadcastPermission(prompt);
  });
}

export function registerPermissionAskIpc(): void {
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

      row.resolve(body.decision);
      return { ok: true };
    },
  );
}

/** Cancel one outstanding permission ask (worker abort / Stop). Broadcasts a cancel so the strip closes. */
export function cancelPermissionAsk(requestId: string, reason = "permission ask cancelled"): void {
  const row = pendingAsks.get(requestId);
  if (!row) return;
  pendingAsks.delete(requestId);
  clearTimeout(row.timer);
  broadcastCancelled(row.sessionId, requestId);
  row.reject(new Error(reason));
}

/** Cancel every outstanding permission ask for one session (renderer Stop / turn abort). */
export function cancelPermissionAsksForSession(
  sessionId: string,
  reason = "permission ask cancelled",
): void {
  for (const [requestId, row] of [...pendingAsks]) {
    if (row.sessionId !== sessionId) continue;
    cancelPermissionAsk(requestId, reason);
  }
}

/** Test / shutdown helper: reject all outstanding asks. */
export function clearPendingPermissionAsks(reason = "permission asks cleared"): void {
  for (const id of [...pendingAsks.keys()]) {
    cancelPermissionAsk(id, reason);
  }
}
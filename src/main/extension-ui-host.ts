import { BrowserWindow, ipcMain } from "electron";
import {
  EXTENSION_UI_TIMEOUT_MS,
  isExtensionUiDialogMethod,
  parseExtensionUiDialogParams,
  parseExtensionUiFireParams,
  type ExtensionUiEvent,
  type ExtensionUiReply,
} from "../shared/extension-ui";
import { IpcChannels } from "../shared/protocol";

type PendingDialog = {
  sessionId: string;
  resolve: (reply: ExtensionUiReply) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pendingDialogs = new Map<string, PendingDialog>();

function broadcast(event: ExtensionUiEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.sessions.extensionUi, event);
  }
}

function broadcastCancelled(sessionId: string, requestId: string): void {
  broadcast({ sessionId, requestId, cancelled: true });
}

/**
 * Handle worker `desktop.extensionUi` RPC.
 * Dialogs wait for renderer reply; fire-and-forget methods return immediately.
 */
export async function handleExtensionUiRpc(
  sessionId: string,
  requestId: string,
  params: Record<string, unknown>,
): Promise<ExtensionUiReply | { ok: true }> {
  const method = params.method;
  if (typeof method !== "string") {
    throw new Error("desktop.extensionUi: method required");
  }

  if (isExtensionUiDialogMethod(method)) {
    const dialog = parseExtensionUiDialogParams(params, requestId);
    if (!dialog) {
      throw new Error(`desktop.extensionUi: invalid ${method} params`);
    }
    if (BrowserWindow.getAllWindows().length === 0) {
      throw new Error("extension UI unavailable");
    }
    if (pendingDialogs.has(requestId)) {
      throw new Error(`duplicate extension UI request: ${requestId}`);
    }

    const timeoutRaw = params.timeout;
    const timeoutMs =
      typeof timeoutRaw === "number" && timeoutRaw > 0
        ? timeoutRaw
        : EXTENSION_UI_TIMEOUT_MS;

    return new Promise<ExtensionUiReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingDialogs.delete(requestId);
        broadcastCancelled(sessionId, requestId);
        reject(new Error("extension UI prompt timed out"));
      }, timeoutMs);

      pendingDialogs.set(requestId, { sessionId, resolve, timer });
      broadcast({ sessionId, ...dialog });
    });
  }

  const fire = parseExtensionUiFireParams(params);
  if (!fire) {
    throw new Error(`desktop.extensionUi: unsupported method ${method}`);
  }

  switch (fire.method) {
    case "notify":
      broadcast({
        sessionId,
        method: "notify",
        message: fire.message,
        notifyType: fire.notifyType,
      });
      break;
    case "setEditorText":
      broadcast({ sessionId, method: "setEditorText", text: fire.text });
      break;
    case "setStatus":
      broadcast({
        sessionId,
        method: "setStatus",
        statusKey: fire.statusKey,
        statusText: fire.statusText,
      });
      break;
    case "setWidget":
      broadcast({
        sessionId,
        method: "setWidget",
        widgetKey: fire.widgetKey,
        widgetLines: fire.widgetLines,
      });
      break;
    case "setTitle":
      broadcast({ sessionId, method: "setTitle", title: fire.title });
      break;
    default: {
      const _never: never = fire;
      void _never;
    }
  }
  return { ok: true };
}

export function registerExtensionUiIpc(): void {
  ipcMain.handle(
    IpcChannels.sessions.extensionUiReply,
    async (_event, body: ExtensionUiReply) => {
      if (!body || typeof body !== "object") {
        throw new Error("extensionUiReply: body required");
      }
      const requestId = typeof body.requestId === "string" ? body.requestId : "";
      if (!requestId) {
        throw new Error("extensionUiReply: requestId required");
      }
      const row = pendingDialogs.get(requestId);
      if (!row) {
        return { ok: false, reason: "unknown_or_expired" as const };
      }
      pendingDialogs.delete(requestId);
      clearTimeout(row.timer);
      row.resolve(body);
      return { ok: true };
    },
  );
}

export function clearPendingExtensionUiAsks(reason = "extension UI cleared"): void {
  for (const [id, row] of pendingDialogs) {
    clearTimeout(row.timer);
    broadcastCancelled(row.sessionId, id);
    row.resolve({ requestId: id, cancelled: true });
    pendingDialogs.delete(id);
  }
  void reason;
}

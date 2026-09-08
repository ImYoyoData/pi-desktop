import { BrowserWindow, ipcMain } from "electron";
import {
  parseAskUserArgs,
  type AskUserAskPrompt,
  type AskUserAskReply,
  type AskUserAskRequest,
  type AskUserQuestion,
} from "../shared/ask-user";
import { IpcChannels } from "../shared/protocol";

type PendingAsk = {
  sessionId: string;
  resolve: (answersText: string) => void;
  reject: (err: Error) => void;
};

const pendingAsks = new Map<string, PendingAsk>();

function broadcastAskUser(payload: AskUserAskRequest): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.sessions.askUser, payload);
  }
}

function broadcastCancelled(sessionId: string, requestId: string): void {
  broadcastAskUser({ sessionId, requestId, cancelled: true });
}

/**
 * Block the worker until the renderer AskUserStrip submits all answers.
 *
 * No auto-timeout — the ask waits until the user answers, hits Stop, or the
 * session tears down (each of those broadcasts a cancel through cancelAskUserAsk).
 */
export function askRendererAskUser(input: {
  sessionId: string;
  requestId: string;
  questions: AskUserQuestion[];
}): Promise<string> {
  const { requestId, sessionId, questions } = input;

  return new Promise((resolve, reject) => {
    if (BrowserWindow.getAllWindows().length === 0) {
      reject(new Error("ask_user UI unavailable"));
      return;
    }
    if (pendingAsks.has(requestId)) {
      reject(new Error(`duplicate ask_user request: ${requestId}`));
      return;
    }
    if (!questions.length) {
      reject(new Error("ask_user: empty questions"));
      return;
    }

    pendingAsks.set(requestId, { sessionId, resolve, reject });

    const payload: AskUserAskPrompt = {
      sessionId,
      requestId,
      questions,
    };
    broadcastAskUser(payload);
  });
}

/** Cancel one outstanding ask (worker abort / Stop). Broadcasts a cancel so the strip closes. */
export function cancelAskUserAsk(requestId: string, reason = "ask_user cancelled"): void {
  const row = pendingAsks.get(requestId);
  if (!row) return;
  pendingAsks.delete(requestId);
  broadcastCancelled(row.sessionId, requestId);
  row.reject(new Error(reason));
}

export function registerAskUserIpc(): void {
  ipcMain.handle(
    IpcChannels.sessions.askUserReply,
    async (_event, body: AskUserAskReply) => {
      if (!body || typeof body !== "object") {
        throw new Error("askUserReply: body required");
      }
      const requestId = typeof body.requestId === "string" ? body.requestId : "";
      const answersText =
        typeof body.answersText === "string" ? body.answersText.trim() : "";
      if (!requestId) {
        throw new Error("askUserReply: requestId required");
      }
      const row = pendingAsks.get(requestId);
      if (!row) {
        return { ok: false, reason: "unknown_or_expired" as const };
      }
      pendingAsks.delete(requestId);
      if (!answersText) {
        row.reject(new Error("ask_user: empty answers"));
        return { ok: false, reason: "empty_answers" as const };
      }
      row.resolve(answersText);
      return { ok: true };
    },
  );
}

export function clearPendingAskUserAsks(reason = "ask_user asks cleared"): void {
  for (const id of [...pendingAsks.keys()]) {
    cancelAskUserAsk(id, reason);
  }
}

/** Parse RPC params into normalized questions (with ensured custom options). */
export function questionsFromAskUserParams(
  params: Record<string, unknown>,
): AskUserQuestion[] {
  const parsed = parseAskUserArgs(params);
  return parsed?.questions ?? [];
}

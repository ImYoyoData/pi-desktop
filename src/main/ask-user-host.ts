import { BrowserWindow, ipcMain } from "electron";
import {
  ASK_USER_TIMEOUT_MS,
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
  timer: ReturnType<typeof setTimeout>;
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
 */
export function askRendererAskUser(input: {
  sessionId: string;
  requestId: string;
  questions: AskUserQuestion[];
  timeoutMs?: number;
}): Promise<string> {
  const timeoutMs = input.timeoutMs ?? ASK_USER_TIMEOUT_MS;
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

    const timer = setTimeout(() => {
      pendingAsks.delete(requestId);
      broadcastCancelled(sessionId, requestId);
      reject(new Error("ask_user prompt timed out"));
    }, timeoutMs);

    pendingAsks.set(requestId, {
      sessionId,
      resolve,
      reject,
      timer,
    });

    const payload: AskUserAskPrompt = {
      sessionId,
      requestId,
      questions,
    };
    broadcastAskUser(payload);
  });
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
      clearTimeout(row.timer);
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
  for (const [id, row] of pendingAsks) {
    clearTimeout(row.timer);
    broadcastCancelled(row.sessionId, id);
    row.reject(new Error(reason));
    pendingAsks.delete(id);
  }
}

/** Parse RPC params into normalized questions (with ensured custom options). */
export function questionsFromAskUserParams(
  params: Record<string, unknown>,
): AskUserQuestion[] {
  const parsed = parseAskUserArgs(params);
  return parsed?.questions ?? [];
}

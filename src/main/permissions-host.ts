/**
 * 工具审批：档位读写 + 待审批询问在 main 里等渲染层回复。
 * 档位落在 settings.json 的 desktopSecurity 段，主进程缓存一份，避免每次工具调用读盘。
 */

import { BrowserWindow, ipcMain } from "electron";
import {
  classifyToolName,
  evaluatePermission,
  isPermissionDecision,
  parsePermissionCheckParams,
  parsePermissionSettings,
  permissionSettingsPatch,
  type PermissionAskPrompt,
  type PermissionAskReply,
  type PermissionAskRequest,
  type PermissionCategory,
  type PermissionCheckResult,
  type PermissionDecision,
  type PermissionSettings,
} from "../shared/permissions";
import { IpcChannels } from "../shared/protocol";
import { readSettingsRoot, settingsPath, updateSettingsRoot } from "./settings-file";

/** 等用户看清交互条的上限；超时按拒绝处理（fail closed）。 */
const PERMISSION_ASK_TIMEOUT_MS = 10 * 60 * 1000;

const DENY_REASON =
  "Blocked by Pi Desktop permission settings. Change the permission mode on the Permissions settings page to allow this action.";

const TIMEOUT_REASON = "Permission prompt timed out or UI unavailable — denied.";

type PendingAsk = {
  sessionId: string;
  category: PermissionCategory;
  toolName: string;
  summary: string;
  danger: boolean;
  resolve: (decision: PermissionDecision) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pendingAsks = new Map<string, PendingAsk>();
const sessionAllows = new Map<string, Set<PermissionCategory>>();
/** 同一会话的审批一次只弹一条，并联调用排队等用户逐条处理。 */
const askChains = new Map<string, Promise<unknown>>();
/** 排队中就被取消（Stop / 会话关闭）的请求；上限只防意外泄漏。 */
const cancelledRequests = new Set<string>();

export function getPermissionSettings(): PermissionSettings {
  return parsePermissionSettings(readSettingsRoot(settingsPath()));
}

export async function setPermissionSettings(next: unknown): Promise<PermissionSettings> {
  const parsed = parsePermissionSettings(next);
  await updateSettingsRoot(permissionSettingsPatch(parsed));
  return parsed;
}

function allowsFor(sessionId: string): Set<PermissionCategory> {
  let row = sessionAllows.get(sessionId);
  if (!row) {
    row = new Set();
    sessionAllows.set(sessionId, row);
  }
  return row;
}

function broadcastPermission(payload: PermissionAskRequest): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(IpcChannels.sessions.permission, payload);
  }
}

function broadcastCancelled(sessionId: string, requestId: string): void {
  broadcastPermission({ sessionId, requestId, cancelled: true });
}

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

function askRenderer(input: {
  sessionId: string;
  requestId: string;
  category: PermissionCategory;
  toolName: string;
  summary: string;
  danger?: boolean;
}): Promise<PermissionDecision> {
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
    }, PERMISSION_ASK_TIMEOUT_MS);

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

/** 排队：前一单结束后才弹下一条，避免同会话的审批条互相覆盖。 */
function askInOrder(
  sessionId: string,
  requestId: string,
  ask: () => Promise<PermissionDecision>,
): Promise<PermissionDecision> {
  const start = (): Promise<PermissionDecision> =>
    cancelledRequests.delete(requestId)
      ? Promise.reject(new Error("permission ask cancelled"))
      : ask();
  const previous = askChains.get(sessionId) ?? Promise.resolve();
  const run = previous.then(start);
  askChains.set(
    sessionId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/** worker 的 tool_call 审批：按档位放行，必要时等用户在交互条上选。 */
export async function handlePermissionCheck(
  sessionId: string,
  requestId: string,
  rawParams: Record<string, unknown>,
): Promise<PermissionCheckResult> {
  const params = parsePermissionCheckParams(rawParams);
  if (!params) return { action: "deny", reason: "Invalid permission request." };

  const category = classifyToolName(params.toolName);
  if (!category) return { action: "allow" };

  const sessionRow = allowsFor(sessionId);
  const evaluation = evaluatePermission({
    category,
    profile: getPermissionSettings().profile,
    command: params.command,
    sessionAllows: sessionRow,
  });
  if (evaluation.action === "allow") return { action: "allow" };

  let decision: PermissionDecision;
  try {
    decision = await askInOrder(sessionId, requestId, () =>
      askRenderer({
        sessionId,
        requestId,
        category,
        toolName: params.toolName,
        summary: params.summary,
        ...(evaluation.danger ? { danger: true } : {}),
      }),
    );
  } catch {
    return { action: "deny", reason: TIMEOUT_REASON };
  }

  if (decision === "deny") return { action: "deny", reason: DENY_REASON };
  if (decision === "allow_session_category") sessionRow.add(category);
  return { action: "allow" };
}

export function cancelPermissionAsk(
  requestId: string,
  reason = "permission ask cancelled",
): void {
  const row = pendingAsks.get(requestId);
  if (!row) {
    // 还在排队：等轮到它时直接拒绝，不弹条。
    if (cancelledRequests.size >= 128) cancelledRequests.clear();
    cancelledRequests.add(requestId);
    return;
  }
  pendingAsks.delete(requestId);
  clearTimeout(row.timer);
  broadcastCancelled(row.sessionId, requestId);
  row.reject(new Error(reason));
}

export function cancelPermissionAsksForSession(
  sessionId: string,
  reason = "permission ask cancelled",
): void {
  for (const [requestId, row] of [...pendingAsks]) {
    if (row.sessionId !== sessionId) continue;
    cancelPermissionAsk(requestId, reason);
  }
}

/** 会话关闭 / 删除：本会话的「允许此类」不再保留。 */
export function clearSessionPermissionAllows(sessionId: string): void {
  sessionAllows.delete(sessionId);
}

export function clearPendingPermissionAsks(reason = "permission asks cleared"): void {
  for (const requestId of [...pendingAsks.keys()]) {
    cancelPermissionAsk(requestId, reason);
  }
}

export function registerPermissionsIpc(): void {
  ipcMain.handle(IpcChannels.permissions.get, () => getPermissionSettings());

  ipcMain.handle(IpcChannels.permissions.set, async (_event, next: unknown) => {
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      throw new Error("permissions.set: settings object is required");
    }
    return setPermissionSettings(next);
  });

  ipcMain.handle(
    IpcChannels.permissions.reply,
    async (_event, body: PermissionAskReply) => {
      if (!body || typeof body !== "object") {
        throw new Error("permissions.reply: body required");
      }
      const requestId = typeof body.requestId === "string" ? body.requestId : "";
      if (!requestId) {
        throw new Error("permissions.reply: requestId required");
      }
      const row = pendingAsks.get(requestId);
      if (!row) {
        return { ok: false, reason: "unknown_or_expired" as const };
      }
      pendingAsks.delete(requestId);
      clearTimeout(row.timer);
      row.resolve(isPermissionDecision(body.decision) ? body.decision : "deny");
      return { ok: true };
    },
  );
}

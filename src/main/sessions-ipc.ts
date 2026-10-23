import { BrowserWindow, ipcMain } from "electron";
import type { AgentCommand } from "../shared/protocol";
import type { SessionImageCacheSource } from "../shared/protocol";
import type { ChatMessageTag } from "../shared/chat-meta";
import { IpcChannels } from "../shared/protocol";
import type { SessionBroker } from "./session-broker";
import { readSessionHistoryPage } from "./session-history";
import {
  cancelAskUserAsksForSession,
  snapshotPendingAskUserAsks,
} from "./ask-user-host";
import {
  cancelExtensionUiAsksForSession,
  snapshotPendingExtensionUiDialogs,
} from "./extension-ui-host";
import { renameSessionFile } from "./session-rename";
import { forkSessionAtUserTurn } from "./session-fork";

function broadcastEvent(event: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send(IpcChannels.sessions.event, event);
    } catch (err) {
      // 单个窗口发送失败不能影响其余窗口与后续事件。
      console.error("[sessions] event broadcast failed:", err);
    }
  }
}

/**
 * A turn abort (renderer Stop / auto-recover) must also tear down whatever UI
 * ask this session is blocked on. ask_user / extension-UI dialogs wait in main,
 * and the worker cannot cancel the ones whose RPCs carry no abort
 * signal — without this the turn stays "running" until the ask times out.
 */
function cancelSessionUiAsks(sessionId: string): void {
  cancelAskUserAsksForSession(sessionId);
  cancelExtensionUiAsksForSession(sessionId);
}

export function registerSessionsIpc(broker: SessionBroker): void {
  broker.onEvent((event) => {
    broadcastEvent(event);
  });

  ipcMain.handle(IpcChannels.sessions.list, (_event, cwd: string) => broker.listSessions(cwd));

  ipcMain.handle(IpcChannels.sessions.create, (_event, cwd: string) => {
    if (!cwd?.trim()) {
      throw new Error("workspace required to create a session");
    }
    return broker.createSession(cwd);
  });

  ipcMain.handle(IpcChannels.sessions.close, (_event, sessionId: string) => {
    const id = String(sessionId ?? "");
    cancelSessionUiAsks(id);
    return broker.closeSession(id);
  });

  ipcMain.handle(
    IpcChannels.sessions.command,
    (_event, sessionId: string, command: AgentCommand) => {
      if (command?.type === "abort") cancelSessionUiAsks(String(sessionId ?? ""));
      return broker.send(sessionId, command);
    },
  );

  ipcMain.handle(IpcChannels.sessions.tryCommand, (_event, sessionId: string, command: AgentCommand) =>
    broker.trySend(sessionId, command),
  );

  ipcMain.handle(IpcChannels.sessions.killWorker, (_event, sessionId: string) =>
    broker.killWorker(sessionId),
  );

  ipcMain.handle(IpcChannels.sessions.restartWorker, (_event, sessionId: string) =>
    broker.restartWorker(sessionId),
  );

  ipcMain.handle(IpcChannels.sessions.status, async (_event, sessionId: string, cwd: string) => {
    const list = await broker.listSessions(cwd);
    return list.find((s) => s.id === sessionId)?.status ?? null;
  });

  ipcMain.handle(IpcChannels.sessions.open, (_event, sessionId: string, cwd: string) =>
    broker.openSession(sessionId, cwd),
  );

  ipcMain.handle(IpcChannels.sessions.delete, (_event, sessionId: string, cwd: string) => {
    const id = String(sessionId ?? "");
    cancelSessionUiAsks(id);
    return broker.deleteSession(id, cwd);
  });

  ipcMain.handle(
    IpcChannels.sessions.setUserMessageMeta,
    (_event, sessionId: string, text: string, tags: ChatMessageTag[]) => {
      broker.persistUserMessageMeta(sessionId, String(text ?? ""), Array.isArray(tags) ? tags : []);
    },
  );
  ipcMain.handle(
    IpcChannels.sessions.deleteCachedImage,
    (_event, sessionId: string, cachePath: string) => {
      broker.deleteCachedImage(sessionId, cachePath);
    },
  );

  ipcMain.handle(
    IpcChannels.sessions.cacheImage,
    (_event, sessionId: string, source: SessionImageCacheSource) =>
      broker.cacheImage(sessionId, source),
  );
  ipcMain.handle(
    IpcChannels.sessions.history,
    (
      _event,
      filePath: string,
      query?: { limit?: number; beforeId?: string | null },
    ) => readSessionHistoryPage(filePath, query),
  );

  // Renderer boots (initial load / reload / language switch) with empty
  // in-memory chat state; main still holds the pending asks, so hand them
  // back for re-display. Replies still go through the normal reply channels
  // with the original requestId, so a recovered strip stays submittable.
  ipcMain.handle(IpcChannels.sessions.pendingUi, () => ({
    asks: snapshotPendingAskUserAsks(),
    extensionDialogs: snapshotPendingExtensionUiDialogs(),
  }));

  ipcMain.handle(
    IpcChannels.sessions.clearContext,
    (_event, sessionId: string, cwd: string) => broker.clearContext(sessionId, cwd),
  );

  ipcMain.handle(
    IpcChannels.sessions.rename,
    async (_event, sessionId: string, cwd: string, name: string) => {
      const list = await broker.listSessions(cwd);
      const target = list.find((s) => s.id === sessionId);
      if (!target?.filePath) {
        throw new Error("session not found");
      }
      const trimmed = name.trim();
      await renameSessionFile(target.filePath, trimmed);
      // Keep live worker summary in sync so list merge / UI don't stay on "新会话" (#3).
      const patched = broker.patchSummary(sessionId, {
        name: trimmed,
        modified: new Date().toISOString(),
      });
      return patched ?? (await broker.listSessions(cwd)).find((s) => s.id === sessionId) ?? null;
    },
  );

  ipcMain.handle(
    IpcChannels.sessions.fork,
    async (
      _event,
      sessionId: string,
      cwd: string,
      userIndex: number,
      expectText?: string,
    ) => {
      const list = await broker.listSessions(cwd);
      const target = list.find((s) => s.id === sessionId);
      if (!target?.filePath) {
        throw new Error("session not found");
      }
      return forkSessionAtUserTurn(target.filePath, Number(userIndex), expectText);
    },
  );
}

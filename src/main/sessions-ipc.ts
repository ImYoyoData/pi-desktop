import { BrowserWindow, ipcMain } from "electron";
import type { AgentCommand } from "../shared/protocol";
import type { SessionImageCacheSource } from "../shared/protocol";
import type { ChatMessageTag } from "../shared/chat-meta";
import type { AgentBackend } from "../shared/agent-backend";
import { agentBackendOf } from "../shared/agent-backend";
import { IpcChannels } from "../shared/protocol";
import type { SessionBroker } from "./session-broker";
import { readAgentTranscriptFromDisk } from "./agent-transcript";
import { readSessionHistoryPage } from "./session-history";
import {
  cancelAskUserAsksForSession,
  snapshotPendingAskUserAsks,
} from "./ask-user-host";
import {
  cancelExtensionUiAsksForSession,
  snapshotPendingExtensionUiDialogs,
} from "./extension-ui-host";
import {
  cancelPermissionAsksForSession,
  clearSessionPermissionAllows,
  snapshotPendingPermissionAsks,
} from "./permissions-host";
import { renameSessionFile } from "./session-rename";
import { renameOmpSessionFile } from "./omp-session-rename";
import { forkSessionAtUserTurn } from "./session-fork";
import { broadcastStateChange } from "./ui-sync";

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
 * 当前打开的会话：桌面端与浏览器预览页跟随最后一次显式切换。
 * 启动后的首次打开只是恢复现场，不广播——否则另一侧会被拽到刚恢复的会话上。
 */
let activeSession: { sessionId: string; cwd: string } | null = null;

function notifyActiveSession(sessionId: string, cwd: string): void {
  if (activeSession?.sessionId === sessionId) return;
  const isRestore = activeSession === null;
  activeSession = { sessionId, cwd };
  if (isRestore) return;
  broadcastStateChange({ scope: "session", payload: activeSession });
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
  cancelPermissionAsksForSession(sessionId);
}

export function registerSessionsIpc(broker: SessionBroker): void {
  broker.onEvent((event) => {
    broadcastEvent(event);
  });

  ipcMain.handle(
    IpcChannels.sessions.list,
    (_event, cwd: string, backend?: AgentBackend) =>
      broker.listSessions(cwd, agentBackendOf(backend)),
  );

  ipcMain.handle(
    IpcChannels.sessions.create,
    (_event, cwd: string, backend?: AgentBackend) => {
      if (!cwd?.trim()) {
        throw new Error("workspace required to create a session");
      }
      return broker.createSession(cwd, agentBackendOf(backend));
    },
  );

  ipcMain.handle(IpcChannels.sessions.close, (_event, sessionId: string) => {
    const id = String(sessionId ?? "");
    cancelSessionUiAsks(id);
    clearSessionPermissionAllows(id);
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

  ipcMain.handle(
    IpcChannels.sessions.status,
    async (_event, sessionId: string, cwd: string, backend?: AgentBackend) => {
      const list = await broker.listSessions(cwd, agentBackendOf(backend));
      return list.find((s) => s.id === sessionId)?.status ?? null;
    },
  );

  ipcMain.handle(
    IpcChannels.sessions.open,
    async (
      _event,
      sessionId: string,
      cwd: string,
      filePath?: string,
      backend?: AgentBackend,
    ) => {
      const opened = await broker.openSession(
        sessionId,
        cwd,
        filePath,
        agentBackendOf(backend),
      );
      if (opened) notifyActiveSession(sessionId, cwd);
      return opened;
    },
  );

  ipcMain.handle(
    IpcChannels.sessions.delete,
    (_event, sessionId: string, cwd: string, backend?: AgentBackend) => {
      const id = String(sessionId ?? "");
      cancelSessionUiAsks(id);
      clearSessionPermissionAllows(id);
      return broker.deleteSession(id, cwd, agentBackendOf(backend));
    },
  );

  ipcMain.handle(
    IpcChannels.sessions.setUserMessageMeta,
    (
      _event,
      sessionId: string,
      text: string,
      tags: ChatMessageTag[],
      displayText?: unknown,
    ) => {
      broker.persistUserMessageMeta(
        sessionId,
        String(text ?? ""),
        Array.isArray(tags) ? tags : [],
        typeof displayText === "string" ? displayText : undefined,
      );
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
  ipcMain.handle(
    IpcChannels.sessions.agentTranscript,
    (_event, filePath: unknown, agentId: unknown) =>
      readAgentTranscriptFromDisk(
        typeof filePath === "string" ? filePath : null,
        typeof agentId === "string" ? agentId : "",
      ),
  );

  // Renderer boots (initial load / reload / language switch) with empty
  // in-memory chat state; main still holds the pending asks, so hand them
  // back for re-display. Replies still go through the normal reply channels
  // with the original requestId, so a recovered strip stays submittable.
  ipcMain.handle(IpcChannels.sessions.pendingUi, () => ({
    asks: snapshotPendingAskUserAsks(),
    extensionDialogs: snapshotPendingExtensionUiDialogs(),
    permissions: snapshotPendingPermissionAsks(),
  }));

  ipcMain.handle(
    IpcChannels.sessions.clearContext,
    (_event, sessionId: string, cwd: string, backend?: AgentBackend) =>
      broker.clearContext(sessionId, cwd, agentBackendOf(backend)),
  );

  ipcMain.handle(
    IpcChannels.sessions.rename,
    async (
      _event,
      sessionId: string,
      cwd: string,
      name: string,
      backend?: AgentBackend,
    ) => {
      const resolvedBackend = agentBackendOf(backend);
      const list = await broker.listSessions(cwd, resolvedBackend);
      const target = list.find((s) => s.id === sessionId);
      if (!target?.filePath) {
        throw new Error("session not found");
      }
      const trimmed = name.trim();
      if (resolvedBackend === "omp") {
        // 有活 worker 时交给它改名：omp 的 SessionManager 内存里也记着标题，
        // 直接改文件会在它下次整文件重写时被旧名字盖回去。
        let sent: unknown;
        try {
          sent = await broker.trySend(sessionId, {
            type: "set_session_name",
            name: trimmed,
          });
        } catch {
          // worker 报错或正好退出：回到写文件这条路径。
          sent = undefined;
        }
        if (sent === undefined) {
          await renameOmpSessionFile(target.filePath, trimmed);
        }
      } else {
        await renameSessionFile(target.filePath, trimmed);
      }
      // Keep live worker summary in sync so list merge / UI don't stay on "新会话" (#3).
      const patched = broker.patchSummary(sessionId, {
        name: trimmed,
        modified: new Date().toISOString(),
      });
      return (
        patched ??
        (await broker.listSessions(cwd, resolvedBackend)).find(
          (s) => s.id === sessionId,
        ) ??
        null
      );
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
      backend?: AgentBackend,
    ) => {
      const resolvedBackend = agentBackendOf(backend);
      if (resolvedBackend === "omp") {
        // OMP 的会话文件格式 pi 的 SDK 打不开，分叉交给它自己的 worker。
        const forked = await broker.send(sessionId, {
          type: "fork_user_turn",
          userIndex: Number(userIndex),
          ...(expectText === undefined ? {} : { expectText }),
        });
        if (!forked || typeof forked !== "object") {
          throw new Error("could not write the forked session");
        }
        return forked as {
          id: string;
          filePath: string;
          cwd: string;
        };
      }
      const list = await broker.listSessions(cwd, resolvedBackend);
      const target = list.find((s) => s.id === sessionId);
      if (!target?.filePath) {
        throw new Error("session not found");
      }
      return forkSessionAtUserTurn(target.filePath, Number(userIndex), expectText);
    },
  );
}

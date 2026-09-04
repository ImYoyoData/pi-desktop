import { BrowserWindow, ipcMain } from "electron";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { SessionExtensionInfo } from "../shared/protocol";
import type { AgentCommand } from "../shared/protocol";
import type { SessionImageCacheSource } from "../shared/protocol";
import type { ChatMessageTag } from "../shared/chat-meta";
import { IpcChannels } from "../shared/protocol";
import type { SessionBroker } from "./session-broker";
import { readSessionHistoryPage } from "./session-history";
import {
  clearSessionResources,
  getSessionResources,
} from "./agent-worker-host";
import { renameSessionFile } from "./session-rename";

/**
 * Enrich an extension entry path with a readable name + brief description.
 * For node_modules packages the package name is taken from the path and
 * package.json is read at exactly that package root (never walks up into
 * an unrelated package). Local ~/.pi/agent/extensions/*.ts files use the
 * file stem as the name.
 */
function describeExtension(entryPath: string): SessionExtensionInfo {
  const norm = entryPath.replace(/\\/g, "/");
  const nmMarker = "/node_modules/";
  const nmIdx = norm.indexOf(nmMarker);
  if (nmIdx >= 0) {
    const rest = norm.slice(nmIdx + nmMarker.length);
    const parts = rest.split("/");
    const scoped = parts[0]?.startsWith("@")
      ? `${parts[0] ?? ""}/${parts[1] ?? ""}`
      : (parts[0] ?? "");
    if (scoped) {
      const pkgRoot = entryPath.slice(0, nmIdx + nmMarker.length + scoped.length);
      try {
        const raw = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
          name?: unknown;
          description?: unknown;
        };
        return {
          path: entryPath,
          name: typeof raw.name === "string" && raw.name ? raw.name : scoped,
          brief: typeof raw.description === "string" ? raw.description : "",
        };
      } catch {
        return { path: entryPath, name: scoped, brief: "" };
      }
    }
  }
  const stem = norm.split("/").pop() ?? basename(entryPath);
  return {
    path: entryPath,
    name: stem.replace(/\.(ts|js|mjs|cjs)$/i, "") || basename(entryPath),
    brief: "",
  };
}

function broadcastEvent(event: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.sessions.event, event);
  }
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
    clearSessionResources(String(sessionId ?? ""));
    return broker.closeSession(sessionId);
  });

  ipcMain.handle(IpcChannels.sessions.command, (_event, sessionId: string, command: AgentCommand) =>
    broker.send(sessionId, command),
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

  ipcMain.handle(IpcChannels.sessions.getInfo, (_event, sessionId: string) => {
    const resources = typeof sessionId === "string" ? getSessionResources(sessionId) : null;
    const extensions = (resources?.extensionPaths ?? []).map(describeExtension);
    return { resources, extensions };
  });

  ipcMain.handle(IpcChannels.sessions.status, async (_event, sessionId: string, cwd: string) => {
    const list = await broker.listSessions(cwd);
    return list.find((s) => s.id === sessionId)?.status ?? null;
  });

  ipcMain.handle(IpcChannels.sessions.open, (_event, sessionId: string, cwd: string) =>
    broker.openSession(sessionId, cwd),
  );

  ipcMain.handle(IpcChannels.sessions.delete, (_event, sessionId: string, cwd: string) => {
    clearSessionResources(String(sessionId ?? ""));
    return broker.deleteSession(sessionId, cwd);
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
}

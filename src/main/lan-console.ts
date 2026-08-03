/**
 * LAN web console ? a lightweight responsive web control panel for Pi
 * Desktop. Default OFF. When enabled it serves a small static page over
 * HTTP and exposes a WebSocket (token-authenticated) that can list/switch
 * workspaces and sessions, read chat history, send prompts, and transcribe
 * voice recorded in the browser using the desktop's configured ASR backend.
 */

import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { app, ipcMain } from "electron";
import { WebSocket, WebSocketServer } from "ws";
import type { SessionBroker } from "./session-broker";
import { readSessionHistoryPage } from "./session-history";
import { getSessionResources } from "./agent-worker-host";
import { transcribePcm } from "./asr-host";
import { getWorkspace, listRecent } from "./workspace-ipc";
import { IpcChannels } from "../shared/protocol";
import type { LanConsoleStatus } from "../shared/protocol";
import type { AgentEvent, SessionHistoryQuery } from "../shared/protocol";

const DEFAULT_PORT = 18700;

type LanConsoleSettings = {
  enabled: boolean;
  port: number;
  token: string;
};

function settingsPath(): string {
  return join(app.getPath("userData"), "lan-console.json");
}

function newToken(): string {
  return randomBytes(16).toString("hex");
}

function readSettings(): LanConsoleSettings {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), "utf8")) as Partial<LanConsoleSettings>;
    return {
      enabled: raw.enabled === true,
      port: typeof raw.port === "number" && raw.port > 0 && raw.port < 65536 ? raw.port : DEFAULT_PORT,
      token: typeof raw.token === "string" && raw.token ? raw.token : newToken(),
    };
  } catch {
    return { enabled: false, port: DEFAULT_PORT, token: newToken() };
  }
}

function writeSettings(s: LanConsoleSettings): void {
  mkdirSync(dirname(settingsPath()), { recursive: true });
  writeFileSync(settingsPath(), `${JSON.stringify(s, null, 2)}\n`, "utf8");
}

function lanIPv4(): string {
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === "IPv4" && !info.internal) return info.address;
    }
  }
  return "127.0.0.1";
}

function webPagePath(): string {
  return join(__dirname, "../lan-web/index.html");
}

function readWebPage(): string | null {
  try {
    const p = webPagePath();
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  } catch {
    return null;
  }
}

let httpServer: Server | null = null;
let wss: WebSocketServer | null = null;
let brokerRef: SessionBroker | null = null;
let offEvents: (() => void) | null = null;

type WsClient = {
  ws: WebSocket;
  authed: boolean;
};

const clients = new Set<WsClient>();

function sendJson(client: WsClient, payload: Record<string, unknown>): void {
  if (client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(payload));
  }
}

function broadcast(payload: Record<string, unknown>): void {
  const raw = JSON.stringify(payload);
  for (const c of clients) {
    if (c.authed && c.ws.readyState === WebSocket.OPEN) c.ws.send(raw);
  }
}

function reply(client: WsClient, id: unknown, payload: Record<string, unknown>): void {
  sendJson(client, { ...payload, id: typeof id === "string" || typeof id === "number" ? id : undefined });
}

function fail(client: WsClient, id: unknown, message: string): void {
  reply(client, id, { type: "error", message });
}

function requireAuth(client: WsClient, id: unknown): boolean {
  if (client.authed) return true;
  fail(client, id, "not authenticated");
  return false;
}

async function handleMessage(client: WsClient, raw: string): Promise<void> {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    fail(client, undefined, "invalid JSON");
    return;
  }
  const type = typeof msg.type === "string" ? msg.type : "";
  const id = msg.id;

  if (type === "hello") {
    const settings = readSettings();
    if (msg.token === settings.token) {
      client.authed = true;
      reply(client, id, { type: "helloOk" });
    } else {
      fail(client, id, "invalid token");
    }
    return;
  }
  if (!requireAuth(client, id)) return;

  switch (type) {
    case "ping":
      reply(client, id, { type: "pong" });
      return;
    case "listWorkspaces": {
      // Same list as the desktop sidebar: desktop recent + Pi CLI workspaces.
      const recent = await listRecent();
      const current = getWorkspace();
      reply(client, id, { type: "workspaces", current, recent });
      return;
    }
    case "listSessions": {
      const root = typeof msg.root === "string" && msg.root ? msg.root : null;
      if (!root || !brokerRef) {
        fail(client, id, "workspace root required");
        return;
      }
      try {
        const sessions = await brokerRef.listSessions(root);
        reply(client, id, { type: "sessions", root, sessions });
      } catch (err) {
        fail(client, id, err instanceof Error ? err.message : String(err));
      }
      return;
    }
    case "openSession": {
      const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : "";
      const root = typeof msg.root === "string" && msg.root ? msg.root : null;
      if (!sessionId || !root || !brokerRef) {
        fail(client, id, "sessionId and root required");
        return;
      }
      try {
        const session = await brokerRef.openSession(sessionId, root);
        reply(client, id, { type: "sessionOpened", session });
      } catch (err) {
        fail(client, id, err instanceof Error ? err.message : String(err));
      }
      return;
    }
    case "getHistory": {
      const filePath = typeof msg.filePath === "string" ? msg.filePath : "";
      if (!filePath) {
        fail(client, id, "filePath required");
        return;
      }
      try {
        const query: SessionHistoryQuery = {};
        if (typeof msg.limit === "number") query.limit = msg.limit;
        if (typeof msg.beforeId === "string" && msg.beforeId) query.beforeId = msg.beforeId;
        const page = await readSessionHistoryPage(filePath, query);
        reply(client, id, { type: "history", ...page });
      } catch (err) {
        fail(client, id, err instanceof Error ? err.message : String(err));
      }
      return;
    }
    case "sendPrompt": {
      const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : "";
      const text = typeof msg.text === "string" ? msg.text : "";
      if (!sessionId || !text.trim() || !brokerRef) {
        fail(client, id, "sessionId and text required");
        return;
      }
      try {
        await brokerRef.send(sessionId, { type: "prompt", message: text.trim() });
        reply(client, id, { type: "sent" });
      } catch (err) {
        fail(client, id, err instanceof Error ? err.message : String(err));
      }
      return;
    }
    case "getSessionInfo": {
      const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : "";
      if (!sessionId) {
        fail(client, id, "sessionId required");
        return;
      }
      reply(client, id, { type: "sessionInfo", sessionId, resources: getSessionResources(sessionId) });
      return;
    }
    case "transcribe": {
      const b64 = typeof msg.pcmBase64 === "string" ? msg.pcmBase64 : "";
      const sampleRate = typeof msg.sampleRate === "number" ? msg.sampleRate : 16000;
      if (!b64) {
        fail(client, id, "pcmBase64 required");
        return;
      }
      try {
        const buf = Buffer.from(b64, "base64");
        if (buf.length < 2) {
          fail(client, id, "empty audio");
          return;
        }
        const pcm = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
        const text = await transcribePcm(pcm, sampleRate);
        reply(client, id, { type: "transcript", text });
      } catch (err) {
        fail(client, id, err instanceof Error ? err.message : String(err));
      }
      return;
    }
    default:
      fail(client, id, `unsupported message type: ${type}`);
  }
}

async function startLanConsole(): Promise<{ ok: boolean; message: string }> {
  if (httpServer) return { ok: true, message: "already running" };
  const settings = readSettings();
  const page = readWebPage();
  if (!page) return { ok: false, message: "LAN web page missing (run npm run build)" };

  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page);
  });

  const ws = new WebSocketServer({ server, path: "/ws" });
  ws.on("connection", (socket) => {
    const client: WsClient = { ws: socket, authed: false };
    clients.add(client);
    socket.on("message", (data) => {
      void handleMessage(client, String(data));
    });
    socket.on("close", () => {
      clients.delete(client);
    });
    socket.on("error", () => {
      clients.delete(client);
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(settings.port, "0.0.0.0", () => resolve());
    });
  } catch (err) {
    ws.close();
    server.close();
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `failed to listen on ${settings.port}: ${detail}` };
  }

  if (brokerRef) {
    offEvents = brokerRef.onEvent((event: AgentEvent) => {
      broadcast({ type: "event", event });
    });
  }

  httpServer = server;
  wss = ws;
  return { ok: true, message: `listening on ${getLanConsoleStatus().baseUrl}` };
}

function stopLanConsole(): void {
  offEvents?.();
  offEvents = null;
  for (const c of clients) {
    try {
      c.ws.close();
    } catch {
      // ignore
    }
  }
  clients.clear();
  try {
    wss?.close();
  } catch {
    // ignore
  }
  wss = null;
  try {
    httpServer?.close();
  } catch {
    // ignore
  }
  httpServer = null;
}

export function getLanConsoleStatus(): LanConsoleStatus {
  const settings = readSettings();
  const baseUrl = `http://${lanIPv4()}:${settings.port}`;
  return {
    enabled: settings.enabled && Boolean(httpServer),
    port: settings.port,
    token: settings.token,
    baseUrl,
    url: `${baseUrl}/?token=${settings.token}`,
  };
}

export function registerLanConsoleIpc(broker: SessionBroker): void {
  brokerRef = broker;

  ipcMain.handle(IpcChannels.lanConsole.getStatus, () => getLanConsoleStatus());

  ipcMain.handle(IpcChannels.lanConsole.setEnabled, async (_e, enabled: boolean) => {
    const settings = readSettings();
    settings.enabled = enabled === true;
    writeSettings(settings);
    if (settings.enabled) {
      const result = await startLanConsole();
      if (!result.ok && !httpServer) {
        // revert the flag when startup failed so the UI shows it as off
        settings.enabled = false;
        writeSettings(settings);
        throw new Error(result.message);
      }
    } else {
      stopLanConsole();
    }
    return getLanConsoleStatus();
  });

  ipcMain.handle(IpcChannels.lanConsole.setPort, async (_e, port: unknown) => {
    const p = typeof port === "number" && port > 0 && port < 65536 ? Math.floor(port) : DEFAULT_PORT;
    const settings = readSettings();
    const wasEnabled = settings.enabled;
    if (wasEnabled) stopLanConsole();
    settings.port = p;
    writeSettings(settings);
    if (wasEnabled) {
      const result = await startLanConsole();
      if (!result.ok) throw new Error(result.message);
    }
    return getLanConsoleStatus();
  });

  ipcMain.handle(IpcChannels.lanConsole.regenerateToken, () => {
    const settings = readSettings();
    settings.token = newToken();
    writeSettings(settings);
    return getLanConsoleStatus();
  });
}

/** Start the console at boot when the setting is enabled (non-fatal on failure). */
export function ensureLanConsoleFromSettings(): void {
  const settings = readSettings();
  console.info(`[lan-console] settings: enabled=${settings.enabled} port=${settings.port} path=${settingsPath()}`);
  if (!settings.enabled) return;
  void startLanConsole()
    .then((r) => console.info(`[lan-console] start: ${r.ok ? "OK" : "FAIL"} ${r.message}`))
    .catch((err) => console.error("[lan-console] start error:", err instanceof Error ? err.message : String(err)));
}

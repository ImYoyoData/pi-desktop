/**
 * LAN web console ? a lightweight responsive web control panel for Pi
 * Desktop. Default OFF. When enabled it serves a small static page over
 * HTTP and exposes a WebSocket (session-token authenticated) that can
 * list/switch workspaces and sessions, read chat history and send prompts.
 * Voice recorded in the browser is proxied through HTTP (/api/transcribe)
 * and recognized by the desktop's configured ASR backend (local or cloud).
 *
 * Auth: username + password login issues a 6-hour session token stored in
 * the browser (localStorage), so a refresh does not require re-login.
 */

import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { app, ipcMain } from "electron";
import selfsigned from "selfsigned";
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
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6h

type LanConsoleSettings = {
  enabled: boolean;
  port: number;
  username: string;
  password: string;
};

/** Active web sessions: token -> expiry epoch ms. */
const authSessions = new Map<string, number>();

function settingsPath(): string {
  return join(app.getPath("userData"), "lan-console.json");
}

function randomToken(): string {
  return randomBytes(24).toString("hex");
}

function readSettings(): LanConsoleSettings {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), "utf8")) as Partial<LanConsoleSettings>;
    return {
      enabled: raw.enabled === true,
      port: typeof raw.port === "number" && raw.port > 0 && raw.port < 65536 ? raw.port : DEFAULT_PORT,
      username: typeof raw.username === "string" ? raw.username : "",
      password: typeof raw.password === "string" ? raw.password : "",
    };
  } catch {
    return { enabled: false, port: DEFAULT_PORT, username: "", password: "" };
  }
}

function writeSettings(s: LanConsoleSettings): void {
  mkdirSync(dirname(settingsPath()), { recursive: true });
  writeFileSync(settingsPath(), `${JSON.stringify(s, null, 2)}\n`, "utf8");
}

function pruneSessions(now = Date.now()): void {
  for (const [tok, exp] of authSessions) {
    if (exp <= now) authSessions.delete(tok);
  }
}

function isValidSessionToken(token: string | null | undefined): boolean {
  if (typeof token !== "string" || !token) return false;
  pruneSessions();
  const exp = authSessions.get(token);
  if (!exp) return false;
  if (exp <= Date.now()) {
    authSessions.delete(token);
    return false;
  }
  return true;
}

function issueSessionToken(): string {
  pruneSessions();
  const token = randomToken();
  authSessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function lanIPv4(): string {
  const ips = lanIPv4s();
  return ips[0] ?? "127.0.0.1";
}

function lanIPv4s(): string[] {
  const out: string[] = [];
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === "IPv4" && !info.internal) out.push(info.address);
    }
  }
  return out;
}

function certPaths(): { key: string; cert: string; meta: string } {
  const dir = app.getPath("userData");
  return {
    key: join(dir, "lan-console.key"),
    cert: join(dir, "lan-console.crt"),
    meta: join(dir, "lan-console-cert-meta.json"),
  };
}

/**
 * Self-signed certificate for HTTPS (mic requires a secure context).
 * Regenerated when the set of LAN IPs changes so the SAN covers the
 * address the phone/PC connects to.
 */
async function ensureCertificate(): Promise<{ key: string; cert: string }> {
  const { key, cert, meta } = certPaths();
  const ips = lanIPv4s();
  let stored = { alg: "", ips: [] as string[] };
  try {
    stored = JSON.parse(readFileSync(meta, "utf8")) as { alg: string; ips: string[] };
  } catch {
    stored = { alg: "", ips: [] };
  }
  const sameIps =
    Array.isArray(stored.ips) &&
    stored.ips.length === ips.length &&
    stored.ips.every((ip, i) => ip === ips[i]);
  const sameAlg = stored.alg === "ec-p256";
  if (existsSync(key) && existsSync(cert) && sameIps && sameAlg) {
    return { key: readFileSync(key, "utf8"), cert: readFileSync(cert, "utf8") };
  }
  const pems = await selfsigned.generate([{ name: "commonName", value: "Pi Desktop" }], {
    days: 365,
    algorithm: "sha256",
    // EC P-256: much faster TLS handshakes than RSA 2048 ? matters on phones
    // (esp. iOS) where self-signed cert validation is the slow part.
    keyType: "ec",
    curve: "P-256",
    extensions: [
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" },
          { type: 2, value: "127.0.0.1" },
          ...ips.map((ip) => ({ type: 2, value: ip })),
        ],
      },
    ],
  });
  mkdirSync(dirname(key), { recursive: true });
  writeFileSync(key, pems.private, "utf8");
  writeFileSync(cert, pems.cert, "utf8");
  writeFileSync(meta, JSON.stringify({ alg: "ec-p256", ips }), "utf8");
  return { key: pems.private, cert: pems.cert };
}

function lanWebDir(): string {
  return join(__dirname, "../lan-web");
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".map": "application/json",
};

let httpServer: HttpServer | null = null;
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

/** Read a JSON request body (bounded to 20 MB). */
function readJsonBody(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 20 * 1024 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function handleHttp(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
): Promise<void> {
  const url = (req.url ?? "/").split("?")[0] ?? "/";
  const method = req.method ?? "GET";

  if (method === "GET") {
    const rel = (url === "/" ? "index.html" : url).replace(/^\/+/, "");
    const dir = lanWebDir();
    const file = join(dir, rel);
    const within = file === join(dir, "index.html") || file.startsWith(dir + sep);
    if (within && existsSync(file) && statSync(file).isFile()) {
      const ct = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
      const cache = extname(file).toLowerCase() === ".html" ? "no-store" : "public, max-age=31536000, immutable";
      res.writeHead(200, { "Content-Type": ct, "Cache-Control": cache });
      res.end(readFileSync(file));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, message: "not found" }));
    return;
  }

  if (method === "POST" && url === "/api/login") {
    const settings = readSettings();
    try {
      const body = await readJsonBody(req);
      if (body.username === settings.username && body.password === settings.password) {
        const token = issueSessionToken();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, token }));
      } else {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: "invalid credentials" }));
      }
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  if (method === "POST" && url === "/api/transcribe") {
    const auth = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!isValidSessionToken(auth)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: "unauthorized" }));
      return;
    }
    try {
      const body = await readJsonBody(req);
      const b64 = typeof body.pcmBase64 === "string" ? body.pcmBase64 : "";
      const sampleRate = typeof body.sampleRate === "number" ? body.sampleRate : 16000;
      if (!b64) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: "pcmBase64 required" }));
        return;
      }
      const buf = Buffer.from(b64, "base64");
      const pcm = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
      const text = await transcribePcm(pcm, sampleRate);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, text }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, message: "not found" }));
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
    if (isValidSessionToken(msg.token)) {
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
      // Kept for backward compatibility; the web page uses the HTTP proxy.
      const b64 = typeof msg.pcmBase64 === "string" ? msg.pcmBase64 : "";
      const sampleRate = typeof msg.sampleRate === "number" ? msg.sampleRate : 16000;
      if (!b64) {
        fail(client, id, "pcmBase64 required");
        return;
      }
      try {
        const buf = Buffer.from(b64, "base64");
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
  if (!settings.username || !settings.password) {
    return { ok: false, message: "set username and password in settings first" };
  }
  if (!existsSync(join(lanWebDir(), "index.html"))) {
    return { ok: false, message: "LAN web page missing (run npm run build)" };
  }

  let tls: { key: string; cert: string };
  try {
    tls = await ensureCertificate();
  } catch (err) {
    return {
      ok: false,
      message: `failed to create HTTPS certificate: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const server = createHttpsServer(
    { key: tls.key, cert: tls.cert },
    (req, res) => {
      void handleHttp(req, res).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
        }
        res.end(JSON.stringify({ ok: false, message: "internal error" }));
      });
    },
  );

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
  authSessions.clear();
}

export function getLanConsoleStatus(): LanConsoleStatus {
  const settings = readSettings();
  const baseUrl = `https://${lanIPv4()}:${settings.port}`;
  return {
    enabled: settings.enabled && Boolean(httpServer),
    port: settings.port,
    username: settings.username,
    hasCredentials: Boolean(settings.username && settings.password),
    baseUrl,
    url: baseUrl,
  };
}

export function registerLanConsoleIpc(broker: SessionBroker): void {
  brokerRef = broker;

  ipcMain.handle(IpcChannels.lanConsole.getStatus, () => getLanConsoleStatus());

  ipcMain.handle(IpcChannels.lanConsole.setCredentials, async (_e, username: unknown, password: unknown) => {
    const u = typeof username === "string" ? username.trim() : "";
    const p = typeof password === "string" ? password : "";
    if (!u || !p) throw new Error("username and password required");
    const settings = readSettings();
    const wasEnabled = settings.enabled;
    if (wasEnabled) stopLanConsole();
    settings.username = u;
    settings.password = p;
    writeSettings(settings);
    if (wasEnabled) {
      const result = await startLanConsole();
      if (!result.ok) throw new Error(result.message);
    }
    return getLanConsoleStatus();
  });

  ipcMain.handle(IpcChannels.lanConsole.setEnabled, async (_e, enabled: boolean) => {
    const settings = readSettings();
    if (enabled && (!settings.username || !settings.password)) {
      throw new Error("set username and password in settings first");
    }
    settings.enabled = enabled === true;
    writeSettings(settings);
    if (settings.enabled) {
      const result = await startLanConsole();
      if (!result.ok && !httpServer) {
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
}

/** Start the console at boot when the setting is enabled (non-fatal on failure). */
export function ensureLanConsoleFromSettings(): void {
  const settings = readSettings();
  console.info(
    `[lan-console] settings: enabled=${settings.enabled} port=${settings.port} credentials=${Boolean(settings.username && settings.password)}`,
  );
  if (!settings.enabled) return;
  void startLanConsole()
    .then((r) => console.info(`[lan-console] start: ${r.ok ? "OK" : "FAIL"} ${r.message}`))
    .catch((err) => console.error("[lan-console] start error:", err instanceof Error ? err.message : String(err)));
}

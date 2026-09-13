/**
 * 远程控制 (Remote Control) — the former "局域网网页控制台".
 *
 * A lightweight responsive web panel for Pi Desktop:
 *
 * - **LAN access (default ON)** — a plain HTTP listener on 0.0.0.0:<port> serving
 *   the built `lan-web` page plus a WebSocket that can list/switch workspaces and
 *   sessions, read chat history and send prompts. Plain HTTP keeps phone setup
 *   free of certificate warnings; the trade-off is that LAN traffic is not
 *   encrypted, so the panel is meant for a trusted local network.
 * - **Public access (default OFF, opt-in)** — a Cloudflare quick tunnel publishes
 *   a `https://<words>.trycloudflare.com` address whose TLS terminates at
 *   Cloudflare's edge, forwarding to the same loopback-only HTTP entry.
 *
 * Login is a single 9-digit numeric PIN shown in the desktop panel; a correct
 * PIN issues a 6-hour session token kept in the browser's localStorage, so a
 * refresh does not require re-entry. Failed attempts are rate limited per client
 * (tightly for tunnel traffic, where guessing is remotely reachable).
 */

import type { Server as HttpServer } from "node:http";
import { createServer as createHttpServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { gzipSync } from "node:zlib";
import { app, BrowserWindow, ipcMain } from "electron";
import { WebSocket, WebSocketServer } from "ws";
import type { SessionBroker } from "./session-broker";
import { readSessionHistoryPage } from "./session-history";
import { getSessionResources } from "./agent-worker-host";
import { listAvailableModels } from "./models-ipc";
import { getWorkspace, listRecent } from "./workspace-ipc";
import { deriveAccessPin, isAccessPin, isValidPinSecret, parseQuickTunnelHost } from "../shared/cloudflare-tunnel";
import {
  applyTunnelOptions,
  disposeTunnel,
  getTunnelStatus,
  onTunnelStatusChange,
  startTunnel,
  stopTunnel,
} from "./cloudflare-tunnel";
import { IpcChannels } from "../shared/protocol";
import type { LanConsoleStatus } from "../shared/protocol";
import type { AgentEvent, SessionHistoryQuery } from "../shared/protocol";

const DEFAULT_PORT = 18700;
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6h
/** A client that lands through the tunnel is remotely reachable — lock harder. */
const LOGIN_MAX_FAILURES = 6;
const LOGIN_LOCK_MS = 10 * 60 * 1000;

type RemoteSettings = {
  /** LAN access switch (default on). */
  enabled: boolean;
  port: number;
  /** User-picked LAN IPv4 for QR / copy URL (may be stale until validated). */
  preferredIp: string;
  /** Public access via Cloudflare tunnel (default off). */
  publicAccess: boolean;
  /** 32-byte hex secret the 9-digit PIN is derived from. */
  pinSecret: string;
  /** Manual cloudflared path; empty ⇒ managed binary under userData. */
  cloudflaredPath: string;
  /** Allow downloading cloudflared automatically. */
  autoDownload: boolean;
};

/** Active web sessions: token -> expiry epoch ms. */
const authSessions = new Map<string, number>();

/** Per-client failed login attempts: client key -> { count, lockedUntil }. */
const loginFailures = new Map<string, { count: number; lockedUntil: number }>();

/** Cached tunnel host so login rate limiting can tell public traffic apart. */
let tunnelHost: string | null = null;

function settingsPath(): string {
  return join(app.getPath("userData"), "lan-console.json");
}

function newPinSecret(): string {
  return randomBytes(32).toString("hex");
}

function readSettings(): RemoteSettings {
  let raw: Partial<RemoteSettings> = {};
  try {
    raw = JSON.parse(readFileSync(settingsPath(), "utf8")) as Partial<RemoteSettings>;
  } catch {
    raw = {};
  }
  const settings: RemoteSettings = {
    // LAN access is on by default; an explicit false (user turned it off) sticks.
    enabled: raw.enabled !== false,
    port: typeof raw.port === "number" && raw.port > 0 && raw.port < 65536 ? Math.floor(raw.port) : DEFAULT_PORT,
    preferredIp: typeof raw.preferredIp === "string" ? raw.preferredIp.trim() : "",
    publicAccess: raw.publicAccess === true,
    pinSecret: isValidPinSecret(raw.pinSecret) ? raw.pinSecret : "",
    cloudflaredPath: typeof raw.cloudflaredPath === "string" ? raw.cloudflaredPath.trim() : "",
    autoDownload: raw.autoDownload !== false,
  };
  if (!settings.pinSecret) {
    // First run (or an upgraded install with username/password): mint the secret
    // once and persist it so the PIN survives restarts.
    settings.pinSecret = newPinSecret();
    writeSettings(settings);
  }
  return settings;
}

function writeSettings(s: RemoteSettings): void {
  mkdirSync(dirname(settingsPath()), { recursive: true });
  writeFileSync(settingsPath(), `${JSON.stringify(s, null, 2)}\n`, "utf8");
}

function accessPin(settings: RemoteSettings): string {
  return deriveAccessPin(settings.pinSecret);
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
  const token = randomBytes(24).toString("hex");
  authSessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function clientKey(req: import("node:http").IncomingMessage): string {
  const socketAddress = req.socket.remoteAddress ?? "";
  const forwarded =
    String(req.headers["cf-connecting-ip"] ?? "").trim() ||
    String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim() ||
    "";
  // Only trust a forwarded address when the request really came from a tunnel
  // (localhost origin) — otherwise a LAN client could spoof its way past the
  // per-client lockout.
  if (forwarded && isLoopback(socketAddress)) return `tunnel:${forwarded}`;
  return `local:${socketAddress}`;
}

function isLoopback(address: string): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function loginLockRemainingMs(key: string, now = Date.now()): number {
  const row = loginFailures.get(key);
  if (!row) return 0;
  if (row.lockedUntil > now) return row.lockedUntil - now;
  if (row.lockedUntil && row.lockedUntil <= now && row.count < LOGIN_MAX_FAILURES) loginFailures.delete(key);
  return 0;
}

function noteLoginFailure(key: string): void {
  const now = Date.now();
  const row = loginFailures.get(key) ?? { count: 0, lockedUntil: 0 };
  row.count += 1;
  if (row.count >= LOGIN_MAX_FAILURES) {
    row.lockedUntil = now + LOGIN_LOCK_MS;
    row.count = 0;
  }
  loginFailures.set(key, row);
}

function clearLoginFailures(key: string): void {
  loginFailures.delete(key);
}

/** Virtual / VPN adapters that often win Object.values() order but are unreachable from phones. */
const VIRTUAL_IFACE_RE =
  /vethernet|hyper-?v|wsl|docker|vmware|vbox|virtualbox|virbr|veth|tun|tap|tailscale|zerotier|hamachi|vpn|ppp|wireguard|\bwg\b|utun|clash|meta|npcap|loopback|bluetooth|isatap|teredo|microsoft wi-?fi direct|hosted network/i;
const PHYSICAL_IFACE_RE =
  /wi-?fi|wlan|wireless|ethernet|eth\d*|en\d+|en0|en1|本地连接|以太网|无线|lan\b|nic/i;

function isIpv4Family(family: string | number): boolean {
  return family === "IPv4" || family === 4;
}

function scoreLanAddress(ifaceName: string, address: string): number {
  let score = 0;
  // vEthernet contains "ethernet" — never award the physical bonus to virtual NICs.
  const virtual = VIRTUAL_IFACE_RE.test(ifaceName);
  if (virtual) score -= 120;
  else if (PHYSICAL_IFACE_RE.test(ifaceName)) score += 55;

  // Prefer common home/office LAN ranges; 172.16/12 is often Docker/WSL.
  if (/^192\.168\./u.test(address)) score += 45;
  else if (/^10\./u.test(address)) score += 35;
  else if (/^172\.(1[6-9]|2\d|3[01])\./u.test(address)) score += 8;
  else score -= 25;

  if (/^169\.254\./u.test(address)) score -= 90; // link-local
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./u.test(address)) score -= 40; // CGNAT
  return score;
}

/** Non-internal IPv4s, best guess for phone/LAN access first. */
function lanIPv4s(): string[] {
  type Row = { name: string; address: string; score: number };
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const [name, infos] of Object.entries(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (!isIpv4Family(info.family) || info.internal) continue;
      if (seen.has(info.address)) continue;
      seen.add(info.address);
      rows.push({ name, address: info.address, score: scoreLanAddress(name, info.address) });
    }
  }
  rows.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
  return rows.map((r) => r.address);
}

function resolvePreferredIp(settings: RemoteSettings): string {
  const ips = lanIPv4s();
  if (settings.preferredIp && ips.includes(settings.preferredIp)) return settings.preferredIp;
  return ips[0] ?? "127.0.0.1";
}

function buildLanUrl(ip: string, port: number): string {
  // Plain HTTP on purpose: no certificate warning on phones. The public side
  // (Cloudflare tunnel) is the one that gets real HTTPS.
  return `http://${ip}:${port}`;
}

function lanWebDir(): string {
  return join(__dirname, "../lan-web");
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".map": "application/json",
};

/** Compressible types — phones on LAN benefit a lot from gzip (naive-less JS still helps). */
const GZIP_EXT = new Set([".html", ".js", ".css", ".svg", ".json", ".map"]);

type CachedAsset = { raw: Buffer; gzip: Buffer; mtimeMs: number };
const assetCache = new Map<string, CachedAsset>();

function readCachedAsset(file: string): CachedAsset {
  const st = statSync(file);
  const hit = assetCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit;
  const raw = readFileSync(file);
  const gzip = GZIP_EXT.has(extname(file).toLowerCase()) && raw.length > 512
    ? gzipSync(raw, { level: 6 })
    : raw;
  const row = { raw, gzip, mtimeMs: st.mtimeMs };
  assetCache.set(file, row);
  return row;
}

/** LAN listener (plain HTTP) + loopback HTTP listener used as the tunnel origin. */
let lanServer: HttpServer | null = null;
let originServer: HttpServer | null = null;
let originPort = 0;
/** One WebSocket server per listener (LAN + tunnel origin). */
const wssServers = new Set<WebSocketServer>();
let lanWss: WebSocketServer | null = null;
let originWss: WebSocketServer | null = null;
let brokerRef: SessionBroker | null = null;
let offEvents: (() => void) | null = null;
let offTunnelStatus: (() => void) | null = null;

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

/** Baseline hardening applied to every panel response. */
function baseHeaders(): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  };
}

function jsonResponse(
  res: import("node:http").ServerResponse,
  status: number,
  payload: Record<string, unknown>,
): void {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    ...baseHeaders(),
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Content-Length": body.length,
  });
  res.end(body);
}

async function handleHttp(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
): Promise<void> {
  const url = (req.url ?? "/").split("?")[0] ?? "/";
  const method = req.method ?? "GET";
  // Requests whose body nobody reads (e.g. form posts) would otherwise stall the
  // socket until the client gives up.
  req.resume();

  if (method === "GET") {
    const rel = (url === "/" ? "index.html" : url).replace(/^\/+/, "");
    const dir = lanWebDir();
    const file = join(dir, rel);
    const within = file === join(dir, "index.html") || file.startsWith(dir + sep);
    if (within && existsSync(file) && statSync(file).isFile()) {
      const ext = extname(file).toLowerCase();
      const ct = MIME[ext] ?? "application/octet-stream";
      const cache = ext === ".html" ? "no-store" : "public, max-age=31536000, immutable";
      const asset = readCachedAsset(file);
      const accept = String(req.headers["accept-encoding"] ?? "");
      const wantGzip = asset.gzip !== asset.raw && /\bgzip\b/i.test(accept);
      const body = wantGzip ? asset.gzip : asset.raw;
      const headers: Record<string, string | number> = {
        ...baseHeaders(),
        "Content-Type": ct,
        "Cache-Control": cache,
        "Content-Length": body.length,
      };
      if (wantGzip) {
        headers["Content-Encoding"] = "gzip";
        headers.Vary = "Accept-Encoding";
      }
      res.writeHead(200, headers);
      res.end(body);
      return;
    }
    jsonResponse(res, 404, { ok: false, message: "not found" });
    return;
  }

  if (method === "POST" && url === "/api/login") {
    const settings = readSettings();
    const key = clientKey(req);
    const lockedMs = loginLockRemainingMs(key);
    if (lockedMs > 0) {
      jsonResponse(res, 429, {
        ok: false,
        message: `尝试次数过多，请 ${Math.ceil(lockedMs / 60000)} 分钟后再试`,
      });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const pin = typeof body.pin === "string" ? body.pin.trim() : "";
      if (isAccessPin(pin) && pin === accessPin(settings)) {
        clearLoginFailures(key);
        jsonResponse(res, 200, { ok: true, token: issueSessionToken() });
      } else {
        noteLoginFailure(key);
        const left = Math.max(0, LOGIN_MAX_FAILURES - (loginFailures.get(key)?.count ?? 0));
        jsonResponse(res, 401, {
          ok: false,
          message: left > 0 ? `密码不正确（还可尝试 ${left} 次）` : "尝试次数过多，已暂时锁定",
        });
      }
    } catch (err) {
      jsonResponse(res, 400, { ok: false, message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  jsonResponse(res, 404, { ok: false, message: "not found" });
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
    if (isValidSessionToken(typeof msg.token === "string" ? msg.token : null)) {
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

    case "listModels": {
      try {
        const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
        const { getModelsConfigService } = await import("./models-config");
        const { paths } = getModelsConfigService();
        const runtime = await ModelRuntime.create({ modelsPath: paths.modelsPath, authPath: paths.authPath });
        const available = await listAvailableModels(runtime);
        reply(client, id, { type: "models", available });
      } catch (err) {
        fail(client, id, err instanceof Error ? err.message : String(err));
      }
      return;
    }
    case "setModel": {
      const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : "";
      const provider = typeof msg.provider === "string" ? msg.provider : "";
      const modelId = typeof msg.modelId === "string" ? msg.modelId : "";
      if (!sessionId || !provider || !modelId || !brokerRef) {
        fail(client, id, "sessionId, provider and modelId required");
        return;
      }
      try {
        await brokerRef.send(sessionId, { type: "set_model", provider, modelId });
        reply(client, id, { type: "sent" });
      } catch (err) {
        fail(client, id, err instanceof Error ? err.message : String(err));
      }
      return;
    }
    case "setThinking": {
      const sessionId2 = typeof msg.sessionId === "string" ? msg.sessionId : "";
      const level = typeof msg.level === "string" ? msg.level : "";
      if (!sessionId2 || !level || !brokerRef) {
        fail(client, id, "sessionId and level required");
        return;
      }
      try {
        await brokerRef.send(sessionId2, { type: "set_thinking_level", level });
        reply(client, id, { type: "sent" });
      } catch (err) {
        fail(client, id, err instanceof Error ? err.message : String(err));
      }
      return;
    }
    case "getSessionState": {
      const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : "";
      if (!sessionId || !brokerRef) {
        fail(client, id, "sessionId required");
        return;
      }
      try {
        // Prefer live worker (no cold start). Fall back to send which may warm the agent.
        let state = await brokerRef.trySend(sessionId, { type: "get_state" });
        if (state === undefined) {
          state = await brokerRef.send(sessionId, { type: "get_state" });
        }
        reply(client, id, { type: "sessionState", sessionId, state });
      } catch (err) {
        fail(client, id, err instanceof Error ? err.message : String(err));
      }
      return;
    }
    default:
      fail(client, id, `unsupported message type: ${type}`);
  }
}

function attachWebSocket(server: HttpServer): WebSocketServer {
  const ws = new WebSocketServer({ server, path: "/ws" });
  ws.on("connection", (socket) => {
    const client: WsClient = { ws: socket, authed: false };
    clients.add(client);
    socket.on("message", (data) => {
      // A malformed frame must never take the panel down with it.
      void handleMessage(client, String(data)).catch((err) => {
        console.error("[remote-control] message failed:", err instanceof Error ? err.message : String(err));
      });
    });
    socket.on("close", () => {
      clients.delete(client);
    });
    socket.on("error", () => {
      clients.delete(client);
    });
  });
  return ws;
}

function detachWebSocket(ws: WebSocketServer): void {
  try {
    ws.close();
  } catch {
    // ignore
  }
}

/** Close every WebSocket server and drop all panel clients (used on shutdown). */
function closeAllWebSockets(): void {
  for (const ws of wssServers) detachWebSocket(ws);
  wssServers.clear();
  lanWss = null;
  originWss = null;
  for (const c of clients) {
    try {
      c.ws.terminate();
    } catch {
      // ignore
    }
  }
  clients.clear();
}

function requestHandler(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
): void {
  void handleHttp(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, message: "internal error" }));
  });
}

/**
 * Start the LAN listener (plain HTTP, all interfaces). Returns `{ ok, message }`
 * instead of throwing so the settings UI can show the reason (port in use,
 * missing build, …).
 */
async function startLanListener(settings: RemoteSettings): Promise<{ ok: boolean; message: string }> {
  if (lanServer) return { ok: true, message: "already running" };
  if (!existsSync(join(lanWebDir(), "index.html"))) {
    return { ok: false, message: "远程控制页面缺失（请先执行 npm run build）" };
  }

  const server = createHttpServer(requestHandler);
  // Attach a WebSocket server to EACH listener. Wiring it to the LAN listener
  // only meant wss://<tunnel-host>/ws fell through to the plain HTTP handler and
  // answered 404 — the public page could load and log in but never stay connected.
  lanWss = attachWebSocket(server);
  wssServers.add(lanWss);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(settings.port, "0.0.0.0", () => resolve());
    });
  } catch (err) {
    detachWebSocket(lanWss);
    wssServers.delete(lanWss);
    lanWss = null;
    server.close();
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `端口 ${settings.port} 监听失败：${detail}` };
  }

  lanServer = server;
  return { ok: true, message: `listening on ${buildLanUrl(resolvePreferredIp(settings), settings.port)}` };
}

function stopLanListener(): void {
  if (lanWss) {
    detachWebSocket(lanWss);
    wssServers.delete(lanWss);
    lanWss = null;
  }
  // Every open socket belongs to the LAN listener unless the tunnel is up, so
  // drop the sessions that were authenticated on the LAN side too.
  for (const c of clients) {
    try {
      c.ws.terminate();
    } catch {
      // ignore
    }
  }
  clients.clear();
  try {
    lanServer?.close();
  } catch {
    // ignore
  }
  lanServer = null;
  authSessions.clear();
}

/**
 * Loopback-only plain-HTTP entry used as the Cloudflare tunnel origin. It is
 * never bound to a public interface: the tunnel connects to 127.0.0.1.
 */
async function startOriginListener(): Promise<number> {
  if (originServer) return originPort;
  const server = createHttpServer(requestHandler);
  // WebSocket must be wired here too, otherwise the public wss:// upgrade is
  // answered by the plain HTTP handler with a 404.
  originWss = attachWebSocket(server);
  wssServers.add(originWss);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
  } catch (err) {
    detachWebSocket(originWss);
    wssServers.delete(originWss);
    originWss = null;
    throw err;
  }
  const address = server.address();
  originPort = typeof address === "object" && address ? address.port : 0;
  originServer = server;
  return originPort;
}

function stopOriginListener(): void {
  if (originWss) {
    detachWebSocket(originWss);
    wssServers.delete(originWss);
    originWss = null;
  }
  try {
    originServer?.close();
  } catch {
    // ignore
  }
  originServer = null;
  originPort = 0;
}

/** Wire agent events + tunnel status once, so both listeners share one feed. */
function attachEventBridges(): void {
  if (!offEvents && brokerRef) {
    offEvents = brokerRef.onEvent((event: AgentEvent) => {
      broadcast({ type: "event", event });
    });
  }
  if (!offTunnelStatus) {
    offTunnelStatus = onTunnelStatusChange((status) => {
      tunnelHost = status.url ? parseQuickTunnelHost(status.url) : null;
      // The public URL appears (and disappears) long after boot, so log every
      // transition — from a log file this is the only way to diagnose a tunnel.
      console.info(
        `[remote-control] tunnel=${status.phase}${status.url ? ` url=${status.url}` : ""}${
          status.error ? ` error=${status.error}` : ""
        }`,
      );
      broadcastTunnelStatus();
    });
  }
}

function broadcastTunnelStatus(): void {
  const status = getTunnelStatus();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.lanConsole.tunnelStatus, status);
  }
}

/** Apply the current public-access preference (download + run cloudflared). */
async function syncPublicAccess(settings: RemoteSettings): Promise<void> {
  applyTunnelOptions({
    customPath: settings.cloudflaredPath,
    autoDownload: settings.autoDownload,
  });
  if (!settings.publicAccess) {
    stopTunnel();
    stopOriginListener();
    tunnelHost = null;
    return;
  }
  let port: number;
  try {
    port = await startOriginListener();
  } catch (err) {
    console.error("[remote-control] tunnel origin failed:", err instanceof Error ? err.message : String(err));
    return;
  }
  await startTunnel(port, {
    customPath: settings.cloudflaredPath,
    autoDownload: settings.autoDownload,
  });
  tunnelHost = getTunnelStatus().url ? parseQuickTunnelHost(getTunnelStatus().url ?? "") : null;
}

/** Bring the remote control up according to settings (non-fatal on failure). */
async function applySettings(settings: RemoteSettings): Promise<void> {
  if (!settings.enabled) {
    stopLanListener();
    stopTunnel();
    stopOriginListener();
    tunnelHost = null;
    return;
  }
  const lan = await startLanListener(settings);
  if (!lan.ok) console.error(`[remote-control] LAN: ${lan.message}`);
  attachEventBridges();
  await syncPublicAccess(settings);
}

export function getLanConsoleStatus(): LanConsoleStatus {
  const settings = readSettings();
  const addresses = lanIPv4s();
  const preferredIp = resolvePreferredIp(settings);
  const baseUrl = buildLanUrl(preferredIp, settings.port);
  const tunnel = getTunnelStatus();
  return {
    enabled: settings.enabled,
    listening: Boolean(lanServer),
    publicAccess: settings.publicAccess,
    port: settings.port,
    pin: accessPin(settings),
    preferredIp,
    addresses,
    urls: addresses.map((ip) => buildLanUrl(ip, settings.port)),
    baseUrl,
    url: baseUrl,
    publicUrl: tunnel.url,
    tunnel,
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
      const lan = await startLanListener(settings);
      if (!lan.ok && !lanServer) {
        // Keep the switch on: the port may free up later (see retryLanOnce).
        console.error(`[remote-control] LAN start failed: ${lan.message}`);
      }
      attachEventBridges();
      scheduleLanRetry();
    } else {
      stopLanListener();
      stopTunnel();
      stopOriginListener();
      tunnelHost = null;
    }
    return getLanConsoleStatus();
  });

  ipcMain.handle(IpcChannels.lanConsole.setPublicAccess, async (_e, enabled: boolean) => {
    const settings = readSettings();
    settings.publicAccess = enabled === true;
    writeSettings(settings);
    if (!settings.enabled && settings.publicAccess) {
      // Public access needs the panel served somewhere; the LAN listener is the
      // natural host, so enabling the tunnel turns LAN access back on too.
      settings.enabled = true;
      writeSettings(settings);
      const lan = await startLanListener(settings);
      if (!lan.ok) console.error(`[remote-control] LAN start failed: ${lan.message}`);
    }
    await syncPublicAccess(settings);
    attachEventBridges();
    return getLanConsoleStatus();
  });

  ipcMain.handle(IpcChannels.lanConsole.setPort, async (_e, port: unknown) => {
    const p = typeof port === "number" && port > 0 && port < 65536 ? Math.floor(port) : DEFAULT_PORT;
    const settings = readSettings();
    const previousPort = settings.port;
    settings.port = p;
    writeSettings(settings);
    stopLanListener();
    if (settings.enabled) {
      const lan = await startLanListener(settings);
      if (!lan.ok) {
        // Roll back to the port that was working before so the panel stays reachable.
        settings.port = previousPort;
        writeSettings(settings);
        await startLanListener(settings);
        throw new Error(lan.message);
      }
    }
    return getLanConsoleStatus();
  });

  ipcMain.handle(IpcChannels.lanConsole.rotatePin, () => {
    const settings = readSettings();
    settings.pinSecret = newPinSecret();
    writeSettings(settings);
    // Everyone who logged in with the old PIN loses access immediately.
    authSessions.clear();
    for (const c of clients) {
      try {
        c.ws.close();
      } catch {
        // ignore
      }
    }
    clients.clear();
    loginFailures.clear();
    return getLanConsoleStatus();
  });

  ipcMain.handle(IpcChannels.lanConsole.setPreferredIp, (_e, ip: unknown) => {
    const next = typeof ip === "string" ? ip.trim() : "";
    const ips = lanIPv4s();
    if (next && !ips.includes(next)) {
      throw new Error(`IP not available on this machine: ${next}`);
    }
    const settings = readSettings();
    settings.preferredIp = next;
    writeSettings(settings);
    return getLanConsoleStatus();
  });
}

/** One delayed retry when the LAN port was busy at boot (e.g. a restart race). */
let lanRetryTimer: NodeJS.Timeout | null = null;
function scheduleLanRetry(delayMs = 20_000): void {
  if (lanRetryTimer || lanServer) return;
  lanRetryTimer = setTimeout(() => {
    lanRetryTimer = null;
    const settings = readSettings();
    if (!settings.enabled || lanServer) return;
    void startLanListener(settings).then((r) => {
      console.info(`[remote-control] LAN retry: ${r.ok ? "OK" : "FAIL"} ${r.message}`);
    });
  }, delayMs);
}

/** Start the remote control at boot according to settings (non-fatal on failure). */
export function ensureLanConsoleFromSettings(): void {
  const settings = readSettings();
  console.info(
    `[remote-control] settings: lan=${settings.enabled} port=${settings.port} public=${settings.publicAccess}`,
  );
  void applySettings(settings)
    .then(() => {
      const status = getLanConsoleStatus();
      console.info(
        `[remote-control] lan=${status.listening ? "ON" : "OFF"} public=${status.tunnel.phase}${
          status.tunnel.url ? ` url=${status.tunnel.url}` : ""
        }${status.tunnel.error ? ` error=${status.tunnel.error}` : ""}`,
      );
      scheduleLanRetry();
    })
    .catch((err) =>
      console.error("[remote-control] start error:", err instanceof Error ? err.message : String(err)),
    );
}

/** App quit / reload: drop listeners, sessions and any cloudflared process. */
export function disposeLanConsole(): void {
  if (lanRetryTimer) {
    clearTimeout(lanRetryTimer);
    lanRetryTimer = null;
  }
  offTunnelStatus?.();
  offTunnelStatus = null;
  offEvents?.();
  offEvents = null;
  disposeTunnel();
  stopOriginListener();
  closeAllWebSockets();
  try {
    lanServer?.close();
  } catch {
    // ignore
  }
  lanServer = null;
  authSessions.clear();
  loginFailures.clear();
}



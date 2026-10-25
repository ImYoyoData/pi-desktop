import { app, BrowserWindow, ipcMain } from "electron";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import {
	DEV_BRIDGE_DEFAULT_PORT,
	DEV_BRIDGE_PORT_OFFSET,
	devBridgeInstance,
} from "../shared/dev-bridge";
type IpcHandler = (
	event: Electron.IpcMainInvokeEvent,
	...args: unknown[]
) => unknown;

type SyncHandler = (
	event: Electron.IpcMainEvent,
	...args: unknown[]
) => void;

type BridgeEvent = Electron.IpcMainInvokeEvent & { returnValue?: unknown };

const handlers = new Map<string, IpcHandler>();
const syncHandlers = new Map<string, SyncHandler>();
const eventClients = new Set<ServerResponse>();

let readyPromise: Promise<void> | null = null;

/** 启动浏览器预览桥：外部浏览器用它访问主进程。 */
export function installDevBridge(): void {
	captureIpcHandlers();
	forwardMainEvents();
	readyPromise = app.whenReady().then(
		() => new Promise<void>((resolve) => setTimeout(resolve, 100)),
	);
	startServer();
}

/** 记录 ipcMain.handle / ipcMain.on 的处理器，供桥按通道转发调用。 */
function captureIpcHandlers(): void {
	const originalHandle = ipcMain.handle.bind(ipcMain);
	ipcMain.handle = ((channel, listener) => {
		handlers.set(channel, listener as IpcHandler);
		originalHandle(channel, listener);
	}) as typeof ipcMain.handle;

	const originalOn = ipcMain.on.bind(ipcMain);
	ipcMain.on = ((channel, listener) => {
		syncHandlers.set(channel, listener as SyncHandler);
		originalOn(channel, listener);
	}) as typeof ipcMain.on;
}

/** 主进程推给渲染层的事件同步转给浏览器预览页。 */
function forwardMainEvents(): void {
	app.on("web-contents-created", (_event, contents) => {
		const original = contents.send.bind(contents);
		contents.send = ((channel: string, ...args: unknown[]) => {
			broadcast(channel, args);
			original(channel, ...args);
		}) as typeof contents.send;
	});
}

function broadcast(channel: string, args: unknown[]): void {
	if (eventClients.size === 0) return;
	const payload = `data: ${JSON.stringify({ channel, args })}\n\n`;
	for (const client of eventClients) client.write(payload);
}

async function dispatch(channel: string, args: unknown[]): Promise<unknown> {
	let handler = handlers.get(channel);
	if (!handler) {
		await readyPromise;
		handler = handlers.get(channel);
	}
	if (handler) return handler(syntheticEvent(), ...args);
	const syncHandler = syncHandlers.get(channel);
	if (syncHandler) {
		const event = syntheticEvent();
		syncHandler(event as unknown as Electron.IpcMainEvent, ...args);
		return event.returnValue;
	}
	throw new Error(`未注册的 IPC 通道: ${channel}`);
}

/** 浏览器没有真实的 webContents，用主窗口代替，保证依赖 event.sender 的处理器可用。 */
function syntheticEvent(): BridgeEvent {
	const sender = BrowserWindow.getAllWindows()[0]?.webContents;
	return {
		sender,
		senderFrame: null,
	} as unknown as BridgeEvent;
}

/**
 * 预览桥端口：与本实例的 Vite 端口一一对应，
 * 页面据此只会连到自己的主进程（连错实例会让两端状态永远对不上）。
 */
function resolveBridgePort(): number {
	const override = Number.parseInt(process.env.PI_DESKTOP_BRIDGE_PORT ?? "", 10);
	if (Number.isInteger(override) && override > 0 && override <= 65535) return override;
	const rendererUrl = process.env.ELECTRON_RENDERER_URL;
	if (rendererUrl) {
		try {
			const port = Number.parseInt(new URL(rendererUrl).port, 10);
			if (Number.isInteger(port) && port > 0) return port + DEV_BRIDGE_PORT_OFFSET;
		} catch {
			// 解析失败时用默认端口
		}
	}
	return DEV_BRIDGE_DEFAULT_PORT;
}

function startServer(): void {
	const port = resolveBridgePort();
	const origin = `http://127.0.0.1:${port}`;
	const instance = devBridgeInstance(port);
	const server = createServer((req, res) => {
		void handleRequest(req, res, instance);
	});
	server.on("error", (error: Error) => {
		console.warn(
			`[dev-bridge] 端口 ${port} 不可用，浏览器预览桥未启动: ${error.message}`,
		);
	});
	server.listen(port, "127.0.0.1", () => {
		console.log(`[dev-bridge] 浏览器预览桥已启动: ${origin}（实例 ${instance}）`);
	});
}

async function handleRequest(
	req: IncomingMessage,
	res: ServerResponse,
	instance: string,
): Promise<void> {
	if (!originAllowed(req)) {
		res.writeHead(403).end("forbidden");
		return;
	}
	applyCors(res, req);
	if (req.method === "OPTIONS") {
		res.writeHead(204).end();
		return;
	}
	const path = req.url ?? "";
	if (req.method === "GET" && path.startsWith("/identity")) {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ instance }));
		return;
	}
	if (req.method === "GET" && path.startsWith("/media")) {
		serveLocalMedia(req, res);
		return;
	}
	if (req.method === "GET" && path.startsWith("/events")) {
		openEventStream(req, res);
		return;
	}
	if (req.method === "POST" && path.startsWith("/invoke")) {
		await respondCall(req, res);
		return;
	}
	if (req.method === "POST" && path.startsWith("/sync")) {
		await respondCall(req, res);
		return;
	}
	res.writeHead(404).end("not found");
}

async function respondCall(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const body = (await readJson(req)) as {
		channel?: string;
		args?: unknown[];
	};
	const channel = body.channel ?? "";
	const args = Array.isArray(body.args) ? body.args : [];
	try {
		const result = await dispatch(channel, args);
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: true, result }));
	} catch (error) {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: false, error: errorMessage(error) }));
	}
}

function openEventStream(req: IncomingMessage, res: ServerResponse): void {
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});
	res.write(": connected\n\n");
	eventClients.add(res);
	const keepAlive = setInterval(() => res.write(": ping\n\n"), 25000);
	req.on("close", () => {
		clearInterval(keepAlive);
		eventClients.delete(res);
	});
}

/** 只允许本机页面访问，避免其它站点借用桥调用主进程。 */
function originAllowed(req: IncomingMessage): boolean {
	const origin = req.headers.origin;
	if (!origin) return true;
	return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/**
 * 供外部浏览器预览读取本地媒体（壁纸图片/视频）。
 * 只能由本机页面发起，避免任意站点借桥读本地文件。
 */
function serveLocalMedia(req: IncomingMessage, res: ServerResponse): void {
	if (!isLocalPageRequest(req)) {
		res.writeHead(403).end("forbidden");
		return;
	}
	const filePath = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("p");
	if (!filePath) {
		res.writeHead(400).end("missing path");
		return;
	}
	let stat: fs.Stats;
	try {
		stat = fs.statSync(filePath);
	} catch {
		res.writeHead(404).end("not found");
		return;
	}
	if (!stat.isFile()) {
		res.writeHead(404).end("not found");
		return;
	}
	const contentType = mediaContentType(filePath);
	const range = parseRange(req.headers.range, stat.size);
	const headers: Record<string, string> = {
		"Content-Type": contentType,
		"Accept-Ranges": "bytes",
		"Cache-Control": "no-cache",
	};
	if (range) {
		headers["Content-Range"] = `bytes ${range.start}-${range.end}/${stat.size}`;
		res.writeHead(206, headers);
		fs.createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
		return;
	}
	headers["Content-Length"] = String(stat.size);
	res.writeHead(200, headers);
	fs.createReadStream(filePath).pipe(res);
}

/** 本机页面：带 localhost 的 Origin 或 Referer。 */
function isLocalPageRequest(req: IncomingMessage): boolean {
	const origin = req.headers.origin ?? "";
	const referer = req.headers.referer ?? "";
	return (
		/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
		/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(referer)
	);
}

function parseRange(
	header: string | undefined,
	size: number,
): { start: number; end: number } | null {
	if (!header) return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!match) return null;
	const [, rawStart, rawEnd] = match;
	if (!rawStart && !rawEnd) return null;
	const start = rawStart ? Number.parseInt(rawStart, 10) : 0;
	const end = rawEnd ? Number.parseInt(rawEnd, 10) : size - 1;
	if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
	if (start < 0 || start >= size || end < start) return null;
	return { start, end: Math.min(end, size - 1) };
}

function mediaContentType(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
	const types: Record<string, string> = {
		".png": "image/png",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".gif": "image/gif",
		".webp": "image/webp",
		".svg": "image/svg+xml",
		".bmp": "image/bmp",
		".mp4": "video/mp4",
		".webm": "video/webm",
		".mov": "video/quicktime",
	};
	return types[ext] ?? "application/octet-stream";
}

function applyCors(res: ServerResponse, req: IncomingMessage): void {
	const origin = req.headers.origin;
	if (!origin) return;
	res.setHeader("Access-Control-Allow-Origin", origin);
	res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function readJson(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	const raw = Buffer.concat(chunks).toString("utf8");
	if (!raw) return {};
	return JSON.parse(raw);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

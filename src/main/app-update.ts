import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { chmod, copyFile, mkdir, open, rename, rm, type FileHandle } from "node:fs/promises";
import { connect as netConnect, type Socket } from "node:net";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { app, session, shell } from "electron";
import {
	Agent,
	Pool,
	Socks5ProxyAgent,
	buildConnector,
	fetch as nodeFetch,
	type Dispatcher,
	type Response as UndiciResponse,
} from "undici";
import { netFetch } from "./net-fetch";
import { readGhToken } from "./github-core";
import { APP_GITHUB_API_RELEASES } from "../shared/app-meta";
import {
	compareVersions,
	isUpdateReleaseAllowed,
	matchUpdateAsset,
	safeAssetFileName,
	type AppUpdateInfo,
	type AppUpdateProgress,
} from "../shared/update";
import { UPDATE_TEMP_DIR_NAME } from "./update-temp";

const PARALLEL_SEGMENTS = 128;
const MIN_SEGMENT_BYTES = 1024 * 1024;

type GithubAsset = {
	name: string;
	size: number;
	browser_download_url: string;
	/** GitHub 资源摘要，形如 `sha256:<hex>`。 */
	digest?: string | null;
};

type GithubRelease = {
	tag_name: string;
	body?: string | null;
	draft?: boolean;
	prerelease?: boolean;
	html_url: string;
	assets?: GithubAsset[];
};

type Segment = { start: number; end: number; position: number; reserved: number };
type ContentRange = { start: number; end: number; total: number };

/** 一次下载会话：可中途取消。 */
export type AppUpdateDownload = {
	/** 下载完成后的安装包路径。 */
	promise: Promise<string>;
	/** 取消下载。 */
	cancel: () => void;
};

/** 主动取消下载。 */
export class UpdateCancelledError extends Error {
	constructor() {
		super("update download cancelled");
		this.name = "UpdateCancelledError";
	}
}

/** 请求标识：GitHub 要求 User-Agent，dev 构建下 app.getName() 是 Electron。 */
function userAgent(): string {
	return `pi-desktop/${app.getVersion()}`;
}

/** GitHub API 要求 User-Agent，缺失会直接返回 403；有 gh 登录令牌时带上，避免匿名额度限流。 */
function apiHeaders(token: string | null): Record<string, string> {
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"User-Agent": userAgent(),
	};
	if (token) headers.Authorization = `Bearer ${token}`;
	return headers;
}

/** 下载请求头。 */
function downloadHeaders(extra?: Record<string, string>): Record<string, string> {
	return {
		"User-Agent": userAgent(),
		Accept: "application/octet-stream",
		"Accept-Encoding": "identity",
		...extra,
	};
}

/** 取出 GitHub 资源摘要里的 sha256 十六进制串。 */
function normalizeDigest(digest: string | null | undefined): string | null {
	const m = digest?.match(/^sha256:([0-9a-f]{64})$/i);
	return m ? m[1]!.toLowerCase() : null;
}

/** API 限流时的提示：匿名请求按出口 IP 计额，共享代理下很容易被用完。 */
const RATE_LIMIT_MESSAGE =
	"GitHub API 请求限流：未登录请求每个出口 IP 每小时只有 60 次额度，共享代理或同一网络下的人会一起用完。请稍后再试，或改用直连网络。";
/** 已登录账号的额度也用完时，问题不在出口 IP。 */
const AUTH_RATE_LIMIT_MESSAGE = "GitHub API 请求限流：当前 GitHub 账号的额度已用完，请稍后再试。";
/** gh 令牌失效时的提示。 */
const STALE_TOKEN_MESSAGE = "GitHub 登录凭据已失效，请运行 `gh auth login` 后重试。";

/** 把 API 的失败响应翻译成能直接展示给用户的提示。 */
async function describeApiError(response: Response, authenticated: boolean): Promise<string> {
	if (authenticated && response.status === 401) return STALE_TOKEN_MESSAGE;
	if (response.status !== 403 && response.status !== 429) {
		return `GitHub API 请求失败（HTTP ${response.status}）`;
	}
	let body = "";
	try {
		body = await response.text();
	} catch {
		body = "";
	}
	if (/rate limit/i.test(body)) {
		return authenticated ? AUTH_RATE_LIMIT_MESSAGE : RATE_LIMIT_MESSAGE;
	}
	if (response.status === 429) return "GitHub API 请求过于频繁，请稍后再试。";
	return `GitHub API 拒绝访问（HTTP ${response.status}），请检查网络或代理设置。`;
}

async function fetchReleases(): Promise<GithubRelease[]> {
	const token = await readGhToken();
	const response = await netFetch(APP_GITHUB_API_RELEASES, { headers: apiHeaders(token) });
	if (!response.ok) {
		throw new Error(await describeApiError(response, token !== null));
	}
	const payload = (await response.json()) as unknown;
	return Array.isArray(payload) ? (payload as GithubRelease[]) : [];
}

/** 在发布列表里挑出版本最高的一份可用安装包。 */
export async function checkForAppUpdate(
	currentVersion: string,
	force = false,
): Promise<AppUpdateInfo | null> {
	const releases = await fetchReleases();
	let best: AppUpdateInfo | null = null;
	for (const release of releases) {
		if (!isUpdateReleaseAllowed(release, currentVersion)) continue;
		const version = String(release.tag_name ?? "").replace(/^v/i, "");
		if (!version) continue;
		if (!force && compareVersions(version, currentVersion) <= 0) continue;
		const asset = (release.assets ?? []).find((item) =>
			matchUpdateAsset(item.name, process.platform, process.arch),
		);
		if (!asset) continue;
		const info: AppUpdateInfo = {
			version,
			fileName: asset.name,
			downloadUrl: asset.browser_download_url,
			releaseUrl: release.html_url,
			size: asset.size ?? 0,
			digest: normalizeDigest(asset.digest),
			notes: release.body ?? "",
		};
		if (!best || compareVersions(info.version, best.version) > 0) {
			best = info;
		}
	}
	return best;
}

function percentOf(transferred: number, total: number | null): number {
	if (!total || total <= 0) return 0;
	return Math.min(100, Math.round((transferred / total) * 100));
}

/** 速度统计的滑动窗口（毫秒）：多路并发下瞬时值会剧烈跳动，取窗口平均。 */
const SPEED_WINDOW_MS = 2500;
/** 进度回报间隔（毫秒）。 */
const PROGRESS_TICK_MS = 300;

/**
 * 汇总下载字节数，按固定间隔回报进度与速度。
 * 速度取最近 3 秒的滑动窗口平均，避免多路并发造成的瞬时抖动。
 */
function createProgressReporter(
	onProgress: (progress: AppUpdateProgress) => void,
): { report: (bytes: number, total: number | null) => void; received: () => number } {
	let received = 0;
	const startedAt = Date.now();
	let lastTick = startedAt;
	const samples: { at: number; bytes: number }[] = [{ at: startedAt, bytes: 0 }];
	return {
		report: (bytes: number, total: number | null) => {
			received += bytes;
			const now = Date.now();
			if (now - lastTick < PROGRESS_TICK_MS) return;
			lastTick = now;
			samples.push({ at: now, bytes: received });
			while (samples.length > 1 && now - samples[0]!.at > SPEED_WINDOW_MS) {
				samples.shift();
			}
			const first = samples[0]!;
			const span = now - first.at;
			const bytesPerSecond =
				span > 0 ? Math.max(0, ((received - first.bytes) * 1000) / span) : 0;
			onProgress({
				phase: "downloading",
				percent: percentOf(received, total),
				transferred: received,
				total: total ?? 0,
				bytesPerSecond,
			});
		},
		received: () => received,
	};
}

/** Chromium 与 undici 的响应体都是 ReadableStream，统一按异步迭代读取。 */
function toAsyncIterable(body: unknown): AsyncIterable<Uint8Array> {
	return body as AsyncIterable<Uint8Array>;
}

const WRITE_BLOCK_BYTES = 1024 * 1024;

async function writeBlock(
	file: FileHandle,
	block: Buffer,
	start: number,
	onBytes: (bytes: number) => void,
	signal?: AbortSignal,
): Promise<void> {
	let offset = 0;
	while (offset < block.length) {
		signal?.throwIfAborted();
		const { bytesWritten } = await file.write(block, offset, block.length - offset, start + offset);
		if (bytesWritten === 0) throw new Error("写入下载文件失败");
		signal?.throwIfAborted();
		offset += bytesWritten;
		onBytes(bytesWritten);
	}
}

/**
 * 把响应体按顺序写入文件的指定偏移，返回写入字节数。
 * 按块攒批写入，减少 await file.write 的次数。
 */
async function writeBody(
	body: AsyncIterable<Uint8Array>,
	file: FileHandle,
	start: number,
	onBytes: (bytes: number) => void,
	signal?: AbortSignal,
): Promise<number> {
	let position = start;
	let pending: Buffer[] = [];
	let pendingBytes = 0;

	async function flush(): Promise<void> {
		if (pendingBytes === 0) return;
		const block = pending.length === 1 ? pending[0]! : Buffer.concat(pending, pendingBytes);
		pending = [];
		pendingBytes = 0;
		await writeBlock(file, block, position, (bytes) => {
			position += bytes;
			onBytes(bytes);
		}, signal);
	}

	for await (const chunk of body) {
		signal?.throwIfAborted();
		const buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
		pending.push(buffer);
		pendingBytes += buffer.length;
		if (pendingBytes >= WRITE_BLOCK_BYTES) {
			await flush();
		}
	}
	await flush();
	return position - start;
}

/** 单个分片的请求超时（毫秒）：连接卡死时要能超时重试，否则整包会一直挂着。 */
const SEGMENT_TIMEOUT_MS = 30_000;

/** 把外部中止信号与请求超时合并，任一触发都取消。 */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
	const timeout = AbortSignal.timeout(ms);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

const SEGMENT_MAX_ATTEMPTS = 3;
const SEGMENT_RETRY_DELAY_MS = 500;
const MAX_REDIRECTS = 20;

class RangeUnsupportedError extends Error {}

/** 多路并发被服务端/网关限流：不再重试同一分片，直接退回整体下载。 */
class SegmentThrottledError extends Error {}

type ProxyEndpoint = { secure: boolean; host: string; port: number; auth: string | null };

function parseProxyEndpoint(url: string): ProxyEndpoint | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	const secure = parsed.protocol === "https:";
	if (!secure && parsed.protocol !== "http:") return null;
	const auth = parsed.username
		? `Basic ${Buffer.from(`${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`).toString("base64")}`
		: null;
	return { secure, host: parsed.hostname, port: Number(parsed.port || (secure ? 443 : 80)), auth };
}

function abortSignalOf(options: buildConnector.Options): AbortSignal | undefined {
	if (!("signal" in options)) return undefined;
	const signal = options.signal;
	return signal instanceof AbortSignal ? signal : undefined;
}

function tunnelConnector(proxy: ProxyEndpoint): buildConnector.connector {
	return (options, callback) => {
		const targetHost = options.host ?? options.hostname;
		const targetPort = Number(options.port || (options.protocol === "https:" ? 443 : 80));
		const signal = abortSignalOf(options);
		let settled = false;
		let raw: Socket | null = null;
		const finish = (error: Error | null, socket: Socket | TLSSocket | null): void => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", onAbort);
			if (error) {
				socket?.destroy();
				raw?.destroy();
				callback(error, null);
				return;
			}
			if (socket) callback(null, socket);
		};
		const onAbort = (): void => {
			raw?.destroy();
			finish(new Error("代理连接已取消"), null);
		};
		if (signal?.aborted) {
			finish(new Error("代理连接已取消"), null);
			return;
		}
		signal?.addEventListener("abort", onAbort, { once: true });

		const writeConnect = (channel: Socket | TLSSocket): void => {
			const lines = [
				`CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
				`Host: ${targetHost}:${targetPort}`,
			];
			if (proxy.auth) lines.push(`Proxy-Authorization: ${proxy.auth}`);
			channel.write(`${lines.join("\r\n")}\r\n\r\n`);
			let head = Buffer.alloc(0);
			const onHead = (chunk: Buffer): void => {
				head = Buffer.concat([head, chunk]);
				const end = head.indexOf("\r\n\r\n");
				if (end < 0) return;
				channel.removeListener("data", onHead);
				const line = head.subarray(0, head.indexOf("\r\n")).toString("latin1");
				const rest = head.subarray(end + 4);
				channel.setTimeout(0);
				if (!/ 200/.test(line)) {
					channel.destroy();
					finish(new Error(`代理拒绝连接（${line}）`), null);
					return;
				}
				if (options.protocol !== "https:") {
					if (rest.length) channel.unshift(rest);
					finish(null, channel);
					return;
				}
				const secure = tlsConnect({
					socket: channel,
					servername: options.servername ?? targetHost,
					ALPNProtocols: ["http/1.1"],
				});
				secure.once("error", (error) => finish(error, null));
				secure.once("secureConnect", () => {
					if (rest.length) secure.unshift(rest);
					finish(null, secure);
				});
			};
			channel.on("data", onHead);
		};

		raw = netConnect(proxy.port, proxy.host);
		raw.setTimeout(SEGMENT_TIMEOUT_MS, () => {
			raw?.destroy();
			finish(new Error("连接代理超时"), null);
		});
		raw.once("error", (error) => finish(error, null));
		if (proxy.secure) {
			const proxyTls = tlsConnect({ socket: raw, servername: proxy.host, ALPNProtocols: ["http/1.1"] });
			proxyTls.once("error", (error) => finish(error, null));
			proxyTls.once("secureConnect", () => writeConnect(proxyTls));
			return;
		}
		raw.once("connect", () => {
			if (raw) writeConnect(raw);
		});
	};
}

class DownloadRouter {
	private readonly dispatchers = new Map<string, Dispatcher>();
	private readonly routes = new Map<string, string>();

	private async dispatcherFor(url: string, signal: AbortSignal): Promise<Dispatcher | null> {
		const origin = new URL(url).origin;
		let route = this.routes.get(origin);
		if (route === undefined) {
			signal.throwIfAborted();
			route = (await session.defaultSession.resolveProxy(url)).split(";")[0]?.trim() ?? "";
			this.routes.set(origin, route);
		}
		const match = /^(PROXY|HTTPS|SOCKS5)\s+(\S+)$/i.exec(route);
		const kind = match?.[1]?.toUpperCase();
		const proxyUrl = kind === "PROXY"
			? `http://${match![2]}`
			: kind === "HTTPS"
				? `https://${match![2]}`
				: kind === "SOCKS5"
					? `socks5://${match![2]}`
					: null;
		const direct = /^DIRECT$/i.test(route);
		if (!direct && !proxyUrl) return null;
		const key = direct ? "direct" : `${origin}|${proxyUrl}`;
		let dispatcher = this.dispatchers.get(key);
		if (dispatcher) return dispatcher;
		if (direct) {
			dispatcher = new Agent({ connections: PARALLEL_SEGMENTS });
		} else if (proxyUrl!.startsWith("socks5://")) {
			dispatcher = new Socks5ProxyAgent(proxyUrl!, {
				connections: PARALLEL_SEGMENTS,
				connectTimeout: SEGMENT_TIMEOUT_MS,
			});
		} else {
			const endpoint = parseProxyEndpoint(proxyUrl!);
			if (!endpoint) return null;
			dispatcher = new Pool(origin, {
				connections: PARALLEL_SEGMENTS,
				connect: tunnelConnector(endpoint),
			});
		}
		this.dispatchers.set(key, dispatcher);
		return dispatcher;
	}

	async fetch(
		url: string,
		headers: Record<string, string>,
		signal: AbortSignal,
	): Promise<{ response: Response | UndiciResponse; url: string }> {
		let currentUrl = url;
		for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
			const dispatcher = await this.dispatcherFor(currentUrl, signal);
			if (!dispatcher) {
				const response = await netFetch(currentUrl, { headers, signal, redirect: "follow" });
				return { response, url: currentUrl };
			}
			const response = await nodeFetch(currentUrl, { headers, signal, dispatcher, redirect: "manual" });
			const location = response.headers.get("location");
			if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
				return { response, url: currentUrl };
			}
			await response.body?.cancel();
			currentUrl = new URL(location, currentUrl).href;
		}
		throw new Error("下载地址重定向次数过多");
	}

	async close(aborted: boolean): Promise<void> {
		await Promise.allSettled([...this.dispatchers.values()].map((dispatcher) =>
			aborted ? dispatcher.destroy() : dispatcher.close(),
		));
	}
}

async function writeSegmentBody(
	body: AsyncIterable<Uint8Array>,
	file: FileHandle,
	segment: Segment,
	onBytes: (bytes: number) => void,
	signal: AbortSignal,
	timeout: NodeJS.Timeout,
): Promise<void> {
	let pending: Buffer[] = [];
	let pendingBytes = 0;
	const flush = async (): Promise<void> => {
		if (pendingBytes === 0) return;
		const block = pending.length === 1 ? pending[0]! : Buffer.concat(pending, pendingBytes);
		pending = [];
		pendingBytes = 0;
		await writeBlock(file, block, segment.position, (bytes) => {
			segment.position += bytes;
			onBytes(bytes);
		}, signal);
		segment.reserved = segment.position;
	};
	for await (const chunk of body) {
		signal.throwIfAborted();
		timeout.refresh();
		const available = Math.max(0, segment.end - segment.reserved + 1);
		const length = Math.min(chunk.byteLength, available);
		if (length > 0) {
			pending.push(Buffer.from(chunk.buffer, chunk.byteOffset, length));
			pendingBytes += length;
			segment.reserved += length;
		}
		if (pendingBytes >= WRITE_BLOCK_BYTES || segment.reserved > segment.end) await flush();
		if (segment.position > segment.end) break;
	}
	await flush();
	if (segment.position <= segment.end) {
		throw new Error(`分片不完整（剩余 ${segment.end - segment.position + 1} 字节）`);
	}
}

async function downloadSegment(
	router: DownloadRouter,
	url: string,
	segment: Segment,
	total: number,
	file: FileHandle,
	onBytes: (bytes: number) => void,
	signal: AbortSignal,
): Promise<void> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(new Error("分片连接超时")), SEGMENT_TIMEOUT_MS);
	const requestSignal = AbortSignal.any([signal, controller.signal]);
	const start = segment.position;
	const end = segment.end;
	try {
		const { response } = await router.fetch(
			url,
			downloadHeaders({ Range: `bytes=${start}-${end}` }),
			requestSignal,
		);
		timeout.refresh();
		const range = parseContentRange(response.headers.get("content-range"));
		if (response.status !== 206 || !response.body || !range ||
			range.start !== start || range.end !== end || range.total !== total) {
			await response.body?.cancel();
			if (response.status === 200 || response.status === 206) {
				throw new RangeUnsupportedError("服务器未按要求返回下载分片");
			}
			if (response.status === 429 || response.status === 503) {
				throw new SegmentThrottledError(`下载分片被限流（HTTP ${response.status}）`);
			}
			throw new Error(`下载分片失败（HTTP ${response.status}）`);
		}
		await writeSegmentBody(toAsyncIterable(response.body), file, segment, onBytes, requestSignal, timeout);
	} finally {
		clearTimeout(timeout);
		segment.reserved = segment.position;
	}
}

async function downloadSegmentWithRetry(
	router: DownloadRouter,
	url: string,
	segment: Segment,
	total: number,
	file: FileHandle,
	onBytes: (bytes: number) => void,
	signal: AbortSignal,
): Promise<void> {
	for (let attempt = 1; attempt <= SEGMENT_MAX_ATTEMPTS; attempt++) {
		try {
			await downloadSegment(router, url, segment, total, file, onBytes, signal);
			return;
		} catch (err) {
			if (
				signal.aborted ||
				err instanceof RangeUnsupportedError ||
				err instanceof SegmentThrottledError
			)
				throw err;
			if (attempt === SEGMENT_MAX_ATTEMPTS) {
				throw new Error(
					`分片 ${segment.start}-${segment.end} 下载失败（重试 ${attempt} 次）：${
						err instanceof Error ? err.message : String(err)
					}`,
				);
			}
			await sleep(SEGMENT_RETRY_DELAY_MS * attempt, undefined, { signal });
		}
	}
}

function splitSegments(total: number): Segment[] {
	const count = Math.max(1, Math.min(PARALLEL_SEGMENTS, Math.floor(total / MIN_SEGMENT_BYTES)));
	const span = Math.ceil(total / count);
	const segments: Segment[] = [];
	for (let start = 0; start < total; start += span) {
		segments.push({ start, end: Math.min(start + span, total) - 1, position: start, reserved: start });
	}
	return segments;
}

function splitLargestSegment(active: Set<Segment>): Segment | undefined {
	let largest: Segment | undefined;
	for (const segment of active) {
		if (!largest || segment.end - segment.reserved > largest.end - largest.reserved) largest = segment;
	}
	if (!largest) return undefined;
	const remaining = largest.end - largest.reserved + 1;
	if (remaining < MIN_SEGMENT_BYTES * 2) return undefined;
	const start = largest.reserved + Math.floor(remaining / 2);
	const segment = { start, end: largest.end, position: start, reserved: start };
	largest.end = start - 1;
	return segment;
}

async function downloadInSegments(
	router: DownloadRouter,
	url: string,
	total: number,
	filePath: string,
	onBytes: (bytes: number, total: number | null) => void,
	signal?: AbortSignal,
): Promise<void> {
	const file = await open(filePath, "w+");
	const active = new Set<Segment>();
	const controller = new AbortController();
	const workerSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
	let failure: unknown;
	const worker = async (initial: Segment): Promise<void> => {
		try {
			let segment: Segment | undefined = initial;
			while (segment) {
				workerSignal.throwIfAborted();
				active.add(segment);
				try {
					await downloadSegmentWithRetry(router, url, segment, total, file, (bytes) => onBytes(bytes, total), workerSignal);
				} finally {
					active.delete(segment);
				}
				segment = splitLargestSegment(active);
			}
		} catch (err) {
			if (!controller.signal.aborted) {
				failure = err;
				controller.abort(err);
			}
		}
	};
	try {
		await file.truncate(total);
		await Promise.all(splitSegments(total).map(worker));
		if (failure !== undefined) throw failure;
		signal?.throwIfAborted();
	} finally {
		await file.close();
	}
}

async function downloadWhole(
	response: Response,
	filePath: string,
	onBytes: (bytes: number, total: number | null) => void,
	signal?: AbortSignal,
): Promise<void> {
	if (!response.ok || !response.body) {
		throw new Error(`下载失败（HTTP ${response.status}）`);
	}
	const total = Number(response.headers.get("content-length") ?? 0) || null;
	const file = await open(filePath, "w");
	try {
		await writeBody(
			toAsyncIterable(response.body),
			file,
			0,
			(bytes) => onBytes(bytes, total),
			signal,
		);
	} finally {
		await file.close();
	}
}

function parseContentRange(header: string | null): ContentRange | null {
	const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(header ?? "");
	if (!match) return null;
	const start = Number(match[1]);
	const end = Number(match[2]);
	const total = Number(match[3]);
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(total) ||
		start > end || end >= total) return null;
	return { start, end, total };
}

/** 服务端不支持 Range 时的整体下载（走 Chromium 网络栈，跟随应用代理）。 */
async function downloadWholeByChromium(
	info: AppUpdateInfo,
	filePath: string,
	onBytes: (bytes: number, total: number | null) => void,
	signal?: AbortSignal,
): Promise<void> {
	const response = await netFetch(info.downloadUrl, {
		redirect: "follow",
		signal,
		headers: downloadHeaders(),
	});
	await downloadWhole(response, filePath, onBytes, signal);
}

/** 探测请求的超时（毫秒）：连接卡死要能超时重来，不能把整包拖死。 */
const PROBE_TIMEOUT_MS = 15_000;
/** 探测请求的最大尝试次数。 */
const PROBE_MAX_ATTEMPTS = 3;
/** 探测重试的退避基数（毫秒）。 */
const PROBE_RETRY_DELAY_MS = 500;

/** 探测文件总长度：服务端支持 Range 时返回 content-range 里的总数。 */
async function probeAsset(
	router: DownloadRouter,
	info: AppUpdateInfo,
	signal?: AbortSignal,
): Promise<{ url: string; total: number | null }> {
	let lastError = "";
	for (let attempt = 1; attempt <= PROBE_MAX_ATTEMPTS; attempt++) {
		try {
			const { response, url } = await router.fetch(
				info.downloadUrl,
				downloadHeaders({ Range: "bytes=0-0" }),
				withTimeout(signal, PROBE_TIMEOUT_MS),
			);
			const range = response.status === 206
				? parseContentRange(response.headers.get("content-range"))
				: null;
			await response.body?.cancel();
			return { url, total: range?.start === 0 && range.end === 0 ? range.total : null };
		} catch (err) {
			if (signal?.aborted) throw err;
			lastError = err instanceof Error ? err.message : String(err);
			if (attempt < PROBE_MAX_ATTEMPTS) {
				await sleep(PROBE_RETRY_DELAY_MS * attempt, undefined, { signal });
			}
		}
	}
	throw new Error(`无法连接 GitHub 下载服务器：${lastError}`);
}

async function downloadAsset(
	info: AppUpdateInfo,
	filePath: string,
	onBytes: (bytes: number, total: number | null) => void,
	signal?: AbortSignal,
): Promise<void> {
	const router = new DownloadRouter();
	try {
		const { url, total } = await probeAsset(router, info, signal);
		if (!total) {
			await downloadWholeByChromium(info, filePath, onBytes, signal);
			return;
		}
		let transferred = 0;
		try {
			await downloadInSegments(router, url, total, filePath, (bytes, size) => {
				transferred += bytes;
				onBytes(bytes, size);
			}, signal);
		} catch (err) {
			if (
				(!(err instanceof RangeUnsupportedError) &&
					!(err instanceof SegmentThrottledError)) ||
				signal?.aborted
			)
				throw err;
			if (transferred > 0) onBytes(-transferred, total);
			await downloadWholeByChromium(info, filePath, onBytes, signal);
		}
	} finally {
		await router.close(signal?.aborted ?? false);
	}
}

/**
 * 校验下载内容与 GitHub 公布的 sha256 是否一致（流式计算，不整块读入内存）。
 * 拿不到摘要就不装：无法确认完整性时执行安装包风险太大。
 */
async function verifyDigest(filePath: string, expected: string | null, signal?: AbortSignal): Promise<void> {
	if (!expected) {
		throw new Error("GitHub 未提供安装包校验摘要，无法确认文件完整性，请到发布页手动下载");
	}
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(filePath, { signal })) {
		hash.update(chunk);
	}
	signal?.throwIfAborted();
	if (hash.digest("hex").toLowerCase() === expected) return;
	throw new Error("安装包校验失败，已删除损坏的下载文件");
}

/**
 * 下载安装包并回报进度；完成后返回本地文件路径。
 * 中止时抛出 UpdateCancelledError，未完成的分片文件会被清理。
 */
export async function downloadAppUpdate(
	info: AppUpdateInfo,
	onProgress: (progress: AppUpdateProgress) => void,
	signal?: AbortSignal,
): Promise<string> {
	const dir = join(app.getPath("temp"), UPDATE_TEMP_DIR_NAME);
	await mkdir(dir, { recursive: true });
	const fileName = safeAssetFileName(info.fileName);
	if (!fileName) throw new Error("安装包名称无效，已放弃更新");
	const filePath = join(dir, fileName);
	const partPath = `${filePath}.part`;
	await rm(partPath, { force: true });

	const reporter = createProgressReporter(onProgress);
	try {
		await downloadAsset(info, partPath, reporter.report, signal);
		await verifyDigest(partPath, info.digest, signal);
		signal?.throwIfAborted();
		await rm(filePath, { force: true });
		signal?.throwIfAborted();
		await rename(partPath, filePath);
	} catch (err) {
		await rm(partPath, { force: true });
		throw err;
	}

	const received = reporter.received();
	onProgress({
		phase: "done",
		percent: 100,
		transferred: received,
		total: received,
		bytesPerSecond: 0,
	});
	return filePath;
}

/** 启动一次下载并返回可取消的会话。 */
export function startAppUpdateDownload(
	info: AppUpdateInfo,
	onProgress: (progress: AppUpdateProgress) => void,
): AppUpdateDownload {
	const controller = new AbortController();
	return {
		cancel: () => controller.abort(),
		promise: downloadAppUpdate(info, onProgress, controller.signal),
	};
}

/**
 * Windows：NSIS 安装器带 `--updated` 时会等主进程退出（必要时强制结束），
 * 并沿用上次的安装目录，不会再弹出「应用正在运行」的提示。
 */
function launchWindowsInstaller(filePath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(filePath, ["--updated"], {
			detached: true,
			stdio: "ignore",
		});
		child.once("error", (err) => {
			reject(
				new Error(
					`安装程序启动失败：${err.message}。若被系统拦截，请到发布页手动下载安装`,
				),
			);
		});
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
}

/** Linux：把新版本写回当前 AppImage 路径，退出后重新启动即是新版本。 */
async function replaceLinuxAppImage(filePath: string): Promise<void> {
	// AppImage 运行时 app.getPath("exe") 指向挂载目录，真实文件在 APPIMAGE 环境变量里。
	const exePath = process.env.APPIMAGE || app.getPath("exe");
	if (!exePath.endsWith(".AppImage")) {
		throw new Error("当前不是 AppImage 安装，无法自动替换");
	}
	const staged = `${exePath}.new`;
	const backup = `${exePath}.old`;
	await rm(staged, { force: true });
	await rm(backup, { force: true });
	await copyFile(filePath, staged);
	await chmod(staged, 0o755);
	await rename(exePath, backup);
	try {
		await rename(staged, exePath);
	} catch (err) {
		await rename(backup, exePath).catch(() => undefined);
		throw err;
	}
	// 旧文件仍被当前进程占用，但 Linux 允许直接删除，运行中的实例不受影响。
	await rm(backup, { force: true });
}

/**
 * 启动安装程序：Windows 跑安装器，macOS 打开镜像，Linux 替换 AppImage。
 * 返回后调用方退出应用；macOS 需要用户把镜像里的应用拖回应用程序目录。
 */
export async function launchAppUpdate(filePath: string): Promise<void> {
	if (process.platform === "win32") {
		await launchWindowsInstaller(filePath);
		return;
	}
	if (process.platform === "darwin") {
		const err = await shell.openPath(filePath);
		if (err) throw new Error(err);
		return;
	}
	await replaceLinuxAppImage(filePath);
}

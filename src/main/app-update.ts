import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { chmod, copyFile, mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { app, shell } from "electron";
import { Agent, ProxyAgent, fetch as nodeFetch, type Dispatcher } from "undici";
import { netFetch } from "./net-fetch";
import { getNodeProxyMode } from "./proxy-host";
import { APP_GITHUB_API_RELEASES } from "../shared/app-meta";
import type { NodeProxyMode } from "../shared/proxy";
import {
	compareVersions,
	matchUpdateAsset,
	safeAssetFileName,
	type AppUpdateInfo,
	type AppUpdateProgress,
} from "../shared/update";
import { UPDATE_TEMP_DIR_NAME } from "./update-temp";

/** 并发分片数（同时在途的连接数）：Chromium 同域名只复用一条连接，下载走多连接并行。 */
const PARALLEL_SEGMENTS = 256;
/** 每条连接承担的分片数：分片多于连接数，连接池滚动取用，尾部不会掉速。 */
const CHUNKS_PER_CONNECTION = 4;
/** 连接启动的错峰总时长（毫秒）：几百条隧道同时握手会互相拖累，错峰更稳。 */
const CONNECT_STAGGER_SPAN_MS = 3000;
/** 单片最小字节数。 */
const MIN_SEGMENT_BYTES = 128 * 1024;

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

type Segment = { start: number; end: number };

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

/** GitHub API 要求 User-Agent，缺失会直接返回 403。 */
function apiHeaders(): Record<string, string> {
	return {
		Accept: "application/vnd.github+json",
		"User-Agent": userAgent(),
	};
}

/** 下载请求头。 */
function downloadHeaders(extra?: Record<string, string>): Record<string, string> {
	return {
		"User-Agent": userAgent(),
		Accept: "application/octet-stream",
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

/** 把 API 的失败响应翻译成能直接展示给用户的提示。 */
async function describeApiError(response: Response): Promise<string> {
	if (response.status !== 403 && response.status !== 429) {
		return `GitHub API 请求失败（HTTP ${response.status}）`;
	}
	let body = "";
	try {
		body = await response.text();
	} catch {
		body = "";
	}
	if (/rate limit/i.test(body)) return RATE_LIMIT_MESSAGE;
	if (response.status === 429) return "GitHub API 请求过于频繁，请稍后再试。";
	return `GitHub API 拒绝访问（HTTP ${response.status}），请检查网络或代理设置。`;
}

async function fetchReleases(): Promise<GithubRelease[]> {
	const response = await netFetch(APP_GITHUB_API_RELEASES, { headers: apiHeaders() });
	if (!response.ok) {
		throw new Error(await describeApiError(response));
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
		if (release.draft || release.prerelease) continue;
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
				span > 0 ? ((received - first.bytes) * 1000) / span : 0;
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

/**
 * 写盘攒批大小：逐块写会放大 fs 调用开销，攒够再写更快。
 * 取 64KB 是为了进度能连续爬升——分片只有 135KB，阈值过大就要等整块下完才动。
 */
const WRITE_BLOCK_BYTES = 64 * 1024;

/**
 * 把响应体按顺序写入文件的指定偏移，返回写入字节数。
 * 按块攒批写入，减少 await file.write 的次数。
 */
async function writeBody(
	body: AsyncIterable<Uint8Array>,
	file: Awaited<ReturnType<typeof open>>,
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
		await file.write(block, 0, block.length, position);
		position += block.length;
		onBytes(block.length);
	}

	for await (const chunk of body) {
		signal?.throwIfAborted();
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
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

/** 单个分片：独立连接请求，只写自己负责的区间。 */
async function downloadSegment(
	url: string,
	segment: Segment,
	filePath: string,
	dispatcher: Dispatcher,
	onBytes: (bytes: number) => void,
	signal?: AbortSignal,
): Promise<void> {
	const response = await nodeFetch(url, {
		dispatcher,
		redirect: "follow",
		signal: withTimeout(signal, SEGMENT_TIMEOUT_MS),
		headers: downloadHeaders({ Range: `bytes=${segment.start}-${segment.end}` }),
	});
	if (response.status !== 206 || !response.body) {
		throw new Error(`下载分片失败（HTTP ${response.status}）`);
	}
	const expected = segment.end - segment.start + 1;
	const file = await open(filePath, "r+");
	try {
		const written = await writeBody(
			toAsyncIterable(response.body),
			file,
			segment.start,
			onBytes,
			signal,
		);
		if (written !== expected) {
			throw new Error(`分片不完整（${written}/${expected} 字节）`);
		}
	} finally {
		await file.close();
	}
}

/** 单个分片的最多尝试次数：连接被掐断时只重试这一片，不牵动其它分片。 */
const SEGMENT_MAX_ATTEMPTS = 3;
/** 分片重试的退避基数（毫秒）。 */
const SEGMENT_RETRY_DELAY_MS = 500;

/** 等待若干毫秒。 */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 单个分片带重试：代理隧道偶发掐断时只重试这一片。
 * 失败那次已计入的字节要回滚，否则进度会虚高。
 */
async function downloadSegmentWithRetry(
	url: string,
	segment: Segment,
	filePath: string,
	dispatcher: Dispatcher,
	onBytes: (bytes: number) => void,
	signal?: AbortSignal,
): Promise<void> {
	let written = 0;
	for (let attempt = 1; attempt <= SEGMENT_MAX_ATTEMPTS; attempt++) {
		try {
			await downloadSegment(
				url,
				segment,
				filePath,
				dispatcher,
				(bytes) => {
					written += bytes;
					onBytes(bytes);
				},
				signal,
			);
			return;
		} catch (err) {
			if (signal?.aborted) throw err;
			if (written > 0) {
				onBytes(-written);
				written = 0;
			}
			if (attempt >= SEGMENT_MAX_ATTEMPTS) {
				throw new Error(
					`分片 ${segment.start}-${segment.end} 下载失败（重试 ${attempt} 次）：${
						err instanceof Error ? err.message : String(err)
					}`,
				);
			}
			await delay(SEGMENT_RETRY_DELAY_MS * attempt);
		}
	}
}

/**
 * 分片切分：分片数远多于并发连接数，供连接池滚动取用。
 * 一次性把文件平分成 N 段会让尾部只剩少量连接在跑，总速率会掉下去。
 */
function splitSegments(total: number): Segment[] {
	const count = Math.max(
		1,
		Math.min(
			PARALLEL_SEGMENTS * CHUNKS_PER_CONNECTION,
			Math.ceil(total / MIN_SEGMENT_BYTES),
		),
	);
	const span = Math.ceil(total / count);
	const segments: Segment[] = [];
	for (let start = 0; start < total; start += span) {
		segments.push({
			start,
			end: Math.min(start + span, total) - 1,
		});
	}
	return segments;
}

/**
 * 并发分片下载：先按总大小预分配文件，各连接写自己的偏移。
 * 用固定数量的 worker 从分片队列里滚动取任务，任何时刻在途连接数恒定，
 * 速度不会因为尾部连接变少而忽快忽慢。
 */
async function downloadInSegments(
	url: string,
	total: number,
	filePath: string,
	dispatcher: Dispatcher,
	onBytes: (bytes: number, total: number | null) => void,
	signal?: AbortSignal,
): Promise<void> {
	const seed = await open(filePath, "w");
	try {
		await seed.truncate(total);
	} finally {
		await seed.close();
	}

	const segments = splitSegments(total);
	let cursor = 0;

	const workerCount = Math.min(PARALLEL_SEGMENTS, segments.length);
	// 错峰步长按总时长摊分，连接数翻倍也不会拉长爬坡阶段。
	const staggerStep = CONNECT_STAGGER_SPAN_MS / workerCount;

	const worker = async (index: number): Promise<void> => {
		// 错峰建立连接：避免几百条隧道同时握手把代理打满，也避免开头几秒空转。
		if (index > 0) await delay(index * staggerStep);
		for (;;) {
			const chunk = cursor++;
			if (chunk >= segments.length) return;
			await downloadSegmentWithRetry(
				url,
				segments[chunk]!,
				filePath,
				dispatcher,
				(bytes) => onBytes(bytes, total),
				signal,
			);
		}
	};

	const results = await Promise.allSettled(
		Array.from({ length: workerCount }, (_, index) => worker(index)),
	);
	const failed = results.find((result) => result.status === "rejected");
	if (failed?.status === "rejected") throw failed.reason;
}

/** 服务端不支持 Range（含 socks 代理）时的单连接下载。 */
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

/** 从 Content-Range 头里取出总字节数。 */
function contentRangeTotal(header: string | null): number | null {
	const match = /\/(\d+)\s*$/.exec(header ?? "");
	const total = match ? Number(match[1]) : 0;
	return total > 0 ? total : null;
}

/** 分片请求走 Node fetch（undici），代理模式决定用哪种 dispatcher。 */
function createDispatcher(proxy: NodeProxyMode): Dispatcher {
	return proxy.kind === "http" ? new ProxyAgent(proxy.url) : new Agent();
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
async function probeTotalSize(
	info: AppUpdateInfo,
	signal?: AbortSignal,
): Promise<number | null> {
	let lastError = "";
	for (let attempt = 1; attempt <= PROBE_MAX_ATTEMPTS; attempt++) {
		try {
			const response = await netFetch(info.downloadUrl, {
				redirect: "follow",
				signal: withTimeout(signal, PROBE_TIMEOUT_MS),
				headers: downloadHeaders({ Range: "bytes=0-0" }),
			});
			const total =
				response.status === 206
					? contentRangeTotal(response.headers.get("content-range"))
					: null;
			await response.body?.cancel();
			return total;
		} catch (err) {
			if (signal?.aborted) throw err;
			lastError = err instanceof Error ? err.message : String(err);
			if (attempt < PROBE_MAX_ATTEMPTS) {
				await delay(PROBE_RETRY_DELAY_MS * attempt);
			}
		}
	}
	throw new Error(`无法连接 GitHub 下载服务器：${lastError}`);
}

/**
 * 下载安装包到目标路径（先写 .part，成功后再改名）。
 * 走多连接分片并行（Chromium 同域名只复用一条连接，单连接太慢）；
 * 某片连接被掐断只重试该片，不整包回退。
 */
async function downloadAsset(
	info: AppUpdateInfo,
	filePath: string,
	onBytes: (bytes: number, total: number | null) => void,
	signal?: AbortSignal,
): Promise<void> {
	const total = await probeTotalSize(info, signal);
	if (!total) {
		await downloadWholeByChromium(info, filePath, onBytes, signal);
		return;
	}
	await downloadInSegments(
		info.downloadUrl,
		total,
		filePath,
		createDispatcher(getNodeProxyMode()),
		onBytes,
		signal,
	);
}

/**
 * 校验下载内容与 GitHub 公布的 sha256 是否一致（流式计算，不整块读入内存）。
 * 拿不到摘要就不装：无法确认完整性时执行安装包风险太大。
 */
async function verifyDigest(filePath: string, expected: string | null): Promise<void> {
	if (!expected) {
		throw new Error("GitHub 未提供安装包校验摘要，无法确认文件完整性，请到发布页手动下载");
	}
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(filePath)) {
		hash.update(chunk);
	}
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
		await verifyDigest(partPath, info.digest);
		await rm(filePath, { force: true });
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

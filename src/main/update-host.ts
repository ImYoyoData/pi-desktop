import { app, BrowserWindow, ipcMain, shell } from "electron";
import { existsSync, mkdirSync, renameSync, rmSync } from "fs";
import { open, type FileHandle } from "fs/promises";
import { join } from "path";
import { Agent, ProxyAgent, fetch as nodeFetch, type Dispatcher } from "undici";
import { IpcChannels } from "../shared/protocol";
import {
  APP_AUTHOR,
  APP_AUTHOR_EMAIL,
  APP_AUTHOR_QQ,
  APP_GITHUB_API_RELEASES,
  APP_GITHUB_URL,
  APP_RELEASES_URL,
} from "../shared/app-meta";
import {
  emptyUpdateResult,
  isNewerVersion,
  pickReleaseAsset,
  type GhRelease,
  type UpdateCheckResult,
  type UpdateProgress,
} from "../shared/update";
import { netFetch } from "./net-fetch";
import { getNodeProxyMode } from "./proxy-host";
import type { NodeProxyMode } from "../shared/proxy";

let checking = false;
let downloading = false;
let cachedRelease: GhRelease | null = null;
let downloadAbort: AbortController | null = null;

function currentVersion(): string {
  return app.getVersion();
}

function downloadDir(): string {
  const dir = join(app.getPath("temp"), "pi-desktop-updates");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function releaseMeta(release: GhRelease): Pick<
  UpdateCheckResult,
  "latestVersion" | "releaseUrl" | "releaseName" | "releaseNotes"
> {
  return {
    latestVersion: release.tag_name.replace(/^v/i, ""),
    releaseUrl: release.html_url,
    releaseName: release.name?.trim() || release.tag_name,
    releaseNotes: (release.body ?? "").trim() || null,
  };
}

async function fetchLatestRelease(): Promise<GhRelease> {
  // Prefer releases list: GitHub `/releases/latest` excludes prereleases and
  // returns 404 when the newest (or only) release is marked prerelease.
  const res = await netFetch(APP_GITHUB_API_RELEASES, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `pi-desktop/${currentVersion()}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub Releases request failed (HTTP ${res.status})`);
  }
  const list = (await res.json()) as GhRelease[];
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("No GitHub releases found");
  }
  const release = list.find((r) => !r.draft);
  if (!release) {
    throw new Error("No publishable GitHub release found");
  }
  cachedRelease = release;
  return release;
}

const PARALLEL_SEGMENTS = 32;
const MIN_SEGMENT_BYTES = 1024 * 1024;

type Segment = { start: number; end: number };

type SegmentContext = {
  url: string;
  tmp: string;
  dispatcher: Dispatcher;
  signal?: AbortSignal;
};

function downloadHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "User-Agent": `pi-desktop/${currentVersion()}`,
    Accept: "application/octet-stream",
    ...extra,
  };
}

/** 分片数上限 32，每片不小于 1MB（小文件自动减少分片）。 */
function splitSegments(total: number): Segment[] {
  const count = Math.max(
    1,
    Math.min(PARALLEL_SEGMENTS, Math.ceil(total / MIN_SEGMENT_BYTES)),
  );
  const span = Math.ceil(total / count);
  const segments: Segment[] = [];
  for (let start = 0; start < total; start += span) {
    segments.push({ start, end: Math.min(start + span, total) - 1 });
  }
  return segments;
}

function contentRangeTotal(header: string | null): number | null {
  const match = /\/(\d+)\s*$/.exec(header ?? "");
  const total = match ? Number(match[1]) : 0;
  return total > 0 ? total : null;
}

type BodySink = {
  file: FileHandle;
  start: number;
  onBytes: (bytes: number) => void;
  signal?: AbortSignal;
};

/** 把响应体从 start 偏移起顺序写入句柄，返回已写入字节数。
 *  Chromium 与 undici 的 body 均可异步入送；中止时立即停写，不再消耗已缓冲数据。 */
async function writeBody(body: AsyncIterable<Uint8Array>, sink: BodySink): Promise<number> {
  let position = sink.start;
  for await (const chunk of body) {
    sink.signal?.throwIfAborted();
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    await sink.file.write(buffer, 0, buffer.length, position);
    position += buffer.length;
    sink.onBytes(buffer.length);
  }
  return position - sink.start;
}

/** 单个分片：独立连接请求，只写自己的区间。 */
async function downloadSegment(
  ctx: SegmentContext,
  segment: Segment,
  onBytes: (bytes: number) => void,
): Promise<void> {
  const res = await nodeFetch(ctx.url, {
    dispatcher: ctx.dispatcher,
    redirect: "follow",
    signal: ctx.signal,
    headers: downloadHeaders({
      Range: `bytes=${segment.start}-${segment.end}`,
    }),
  });
  if (res.status !== 206 || !res.body) {
    throw new Error(`Download failed (HTTP ${res.status})`);
  }
  const expected = segment.end - segment.start + 1;
  const file = await open(ctx.tmp, "r+");
  try {
    const written = await writeBody(res.body, {
      file,
      start: segment.start,
      onBytes,
      signal: ctx.signal,
    });
    if (written !== expected) {
      throw new Error(`Incomplete segment (${written}/${expected} bytes)`);
    }
  } finally {
    await file.close();
  }
}

/** 分片请求走 Node fetch（undici）：Chromium 对同一域名复用单条连接，无法并行提速。 */
function createDispatcher(proxy: NodeProxyMode): Dispatcher {
  return proxy.kind === "http" ? new ProxyAgent(proxy.url) : new Agent();
}

/** 32 路并行分片：先按总大小预分配文件，每条连接写自己的偏移。
 *  中止时立即断开所有连接并等分片收尾，避免句柄未关就删 .part。 */
async function downloadInSegments(
  total: number,
  ctx: SegmentContext,
  onBytes: (bytes: number, total: number | null) => void,
): Promise<void> {
  const seed = await open(ctx.tmp, "w");
  try {
    await seed.truncate(total);
  } finally {
    await seed.close();
  }

  const jobs = splitSegments(total).map((segment) =>
    downloadSegment(ctx, segment, (bytes) => onBytes(bytes, total)),
  );
  const abort = (): void => void ctx.dispatcher.destroy();
  ctx.signal?.addEventListener("abort", abort, { once: true });
  try {
    const results = await Promise.allSettled(jobs);
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  } finally {
    ctx.signal?.removeEventListener("abort", abort);
    await ctx.dispatcher.destroy();
  }
}

/** 服务端不支持 Range（含 socks 代理）时的单连接回退。 */
async function downloadWhole(
  res: Response,
  tmp: string,
  onBytes: (bytes: number, total: number | null) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (HTTP ${res.status})`);
  }
  const total = Number(res.headers.get("content-length") || 0) || null;
  const file = await open(tmp, "w");
  try {
    await writeBody(res.body, {
      file,
      start: 0,
      onBytes: (bytes) => onBytes(bytes, total),
      signal,
    });
  } finally {
    await file.close();
  }
}

async function downloadAsset(
  url: string,
  dest: string,
  onProgress?: (received: number, total: number | null) => void,
  signal?: AbortSignal,
): Promise<void> {
  const tmp = `${dest}.part`;
  rmSync(tmp, { force: true });

  try {
    const proxy = getNodeProxyMode();
    // socks 无法走 undici 分片，直接整体下载，不做 Range 探测。
    const probeRange = proxy.kind === "socks" ? null : "bytes=0-0";
    const probe = await netFetch(url, {
      redirect: "follow",
      signal,
      headers: downloadHeaders(probeRange ? { Range: probeRange } : undefined),
    });
    const total =
      probeRange && probe.status === 206
        ? contentRangeTotal(probe.headers.get("content-range"))
        : null;
    if (probeRange && probe.status === 206 && !total) {
      throw new Error("Download failed (missing content-range)");
    }

    let received = 0;
    const onBytes = (bytes: number, size: number | null): void => {
      received += bytes;
      onProgress?.(received, size);
    };

    if (total && probe.body) {
      await probe.body.cancel();
      await downloadInSegments(
        total,
        { url, tmp, dispatcher: createDispatcher(proxy), signal },
        onBytes,
      );
    } else {
      await downloadWhole(probe, tmp, onBytes, signal);
    }

    rmSync(dest, { force: true });
    renameSync(tmp, dest);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

function broadcastUpdateProgress(payload: UpdateProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.update.progress, payload);
  }
}

async function openReleaseInBrowser(url?: string | null): Promise<void> {
  await shell.openExternal(url || APP_RELEASES_URL);
}

/** Check only — never downloads, never opens a browser. */
export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  const cur = currentVersion();

  if (checking || downloading) {
    return emptyUpdateResult("error", cur, "Update check already in progress");
  }

  checking = true;
  try {
    const release = await fetchLatestRelease();
    if (release.draft) {
      return emptyUpdateResult("upToDate", cur, `Already on latest v${cur}`, {
        releaseUrl: APP_RELEASES_URL,
      });
    }

    const meta = releaseMeta(release);
    const latest = meta.latestVersion!;
    if (!isNewerVersion(latest, cur)) {
      return emptyUpdateResult("upToDate", cur, `Already on latest v${cur}`, {
        ...meta,
      });
    }

    const asset = pickReleaseAsset(release.assets ?? [], process.platform, process.arch);
    return emptyUpdateResult(
      "available",
      cur,
      asset
        ? `Update available: v${latest}`
        : `Update available: v${latest} (no installer for this OS)`,
      {
        ...meta,
        assetName: asset?.name ?? null,
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return emptyUpdateResult("error", cur, `Update check failed: ${msg}`, {
      releaseUrl: APP_RELEASES_URL,
    });
  } finally {
    checking = false;
  }
}

/** Download + open installer for the latest matching asset. */
export async function downloadAppUpdate(): Promise<UpdateCheckResult> {
  const cur = currentVersion();

  if (checking || downloading) {
    return emptyUpdateResult("error", cur, "Update already in progress");
  }

  checking = true;
  let release: GhRelease;
  try {
    release = cachedRelease ?? (await fetchLatestRelease());
  } catch (err) {
    checking = false;
    const msg = err instanceof Error ? err.message : String(err);
    return emptyUpdateResult("error", cur, `Update check failed: ${msg}`, {
      releaseUrl: APP_RELEASES_URL,
    });
  }
  checking = false;

  const meta = releaseMeta(release);
  const latest = meta.latestVersion!;
  if (!isNewerVersion(latest, cur)) {
    return emptyUpdateResult("upToDate", cur, `Already on latest v${cur}`, meta);
  }

  const asset = pickReleaseAsset(release.assets ?? [], process.platform, process.arch);
  if (!asset) {
    await openReleaseInBrowser(release.html_url);
    return emptyUpdateResult(
      "openedBrowser",
      cur,
      `No installer for this OS — opened release page for v${latest}`,
      { ...meta, assetName: null },
    );
  }

  downloading = true;
  const controller = new AbortController();
  downloadAbort = controller;
  broadcastUpdateProgress({
    phase: "download",
    receivedBytes: 0,
    totalBytes: asset.size || null,
    message: `Downloading ${asset.name}…`,
  });

  const dest = join(downloadDir(), asset.name);
  try {
    await downloadAsset(
      asset.browser_download_url,
      dest,
      (received, total) => {
        broadcastUpdateProgress({
          phase: "download",
          receivedBytes: received,
          totalBytes: total ?? asset.size ?? null,
          message: `Downloading ${asset.name}…`,
        });
      },
      controller.signal,
    );
  } catch (err) {
    if (controller.signal.aborted) {
      broadcastUpdateProgress({
        phase: "cancelled",
        receivedBytes: 0,
        totalBytes: null,
        message: "Download cancelled",
      });
      return emptyUpdateResult("cancelled", cur, `Cancelled v${latest} download`, {
        ...meta,
        assetName: asset.name,
      });
    }
    const msg = err instanceof Error ? err.message : String(err);
    broadcastUpdateProgress({
      phase: "error",
      receivedBytes: 0,
      totalBytes: null,
      message: msg,
    });
    await openReleaseInBrowser(release.html_url);
    return emptyUpdateResult(
      "openedBrowser",
      cur,
      `Auto-download failed — opened browser (${msg})`,
      { ...meta, assetName: asset.name },
    );
  } finally {
    downloadAbort = null;
    downloading = false;
  }

  if (!existsSync(dest)) {
    await openReleaseInBrowser(release.html_url);
    return emptyUpdateResult(
      "openedBrowser",
      cur,
      "Download missing — opened release page",
      { ...meta, assetName: asset.name },
    );
  }

  const openErr = await shell.openPath(dest);
  if (openErr) {
    await openReleaseInBrowser(release.html_url);
    return emptyUpdateResult(
      "openedBrowser",
      cur,
      `Could not open installer (${openErr}) — opened release page`,
      { ...meta, assetName: asset.name },
    );
  }

  broadcastUpdateProgress({
    phase: "done",
    receivedBytes: asset.size || 0,
    totalBytes: asset.size || null,
    message: "Installer launched",
  });

  return emptyUpdateResult(
    "downloaded",
    cur,
    `Downloaded and opened v${latest} installer`,
    { ...meta, assetName: asset.name },
  );
}

/** 中止正在进行的安装包下载；无下载时返回 false。 */
export function cancelAppUpdate(): boolean {
  if (!downloadAbort) return false;
  downloadAbort.abort();
  return true;
}

/** @deprecated Prefer checkForAppUpdate + downloadAppUpdate. */
export async function checkForAppUpdateLegacy(options?: {
  download?: boolean;
}): Promise<UpdateCheckResult> {
  if (options?.download) {
    const check = await checkForAppUpdate();
    if (check.status !== "available") return check;
    return downloadAppUpdate();
  }
  return checkForAppUpdate();
}

export function registerUpdateIpc(): void {
  ipcMain.handle(IpcChannels.update.getAppInfo, () => ({
    version: currentVersion(),
    githubUrl: APP_GITHUB_URL,
    releasesUrl: APP_RELEASES_URL,
    author: APP_AUTHOR,
    qq: APP_AUTHOR_QQ,
    email: APP_AUTHOR_EMAIL,
  }));

  ipcMain.handle(IpcChannels.update.openGithub, async () => {
    await shell.openExternal(APP_GITHUB_URL);
  });

  ipcMain.handle(IpcChannels.update.openReleases, async () => {
    await shell.openExternal(APP_RELEASES_URL);
  });

  ipcMain.handle(IpcChannels.update.openAuthorEmail, async () => {
    await shell.openExternal(`mailto:${APP_AUTHOR_EMAIL}`);
  });

  ipcMain.handle(IpcChannels.update.check, async (_e, opts?: { download?: boolean }) => {
    // Backward compatible: download:true → check then download.
    if (opts?.download) {
      return checkForAppUpdateLegacy({ download: true });
    }
    return checkForAppUpdate();
  });

  ipcMain.handle(IpcChannels.update.download, async () => {
    return downloadAppUpdate();
  });

  ipcMain.handle(IpcChannels.update.cancel, () => cancelAppUpdate());
}

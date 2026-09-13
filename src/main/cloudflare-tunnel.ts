/**
 * Cloudflare quick tunnel ("远程控制" — 公网访问).
 *
 * Public access is opt-in: when the user flips the switch on, we make sure a
 * cloudflared binary is available (downloaded once into userData), then run a
 * zero-config quick tunnel pointing at the desktop's loopback-only HTTP entry:
 *
 *   cloudflared tunnel --url http://127.0.0.1:<originPort>
 *
 * The result is a random https://<words>.trycloudflare.com URL that is valid
 * until the tunnel stops, so the URL is never persisted — it is reported
 * through the status object and re-created on every start.
 */

import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { app, net } from "electron";
import {
  cloudflaredArchiveKind,
  cloudflaredAsset,
  cloudflaredDownloadUrl,
  findAssetSha256,
  parseQuickTunnelUrl,
} from "../shared/cloudflare-tunnel";

const execFileAsync = promisify(execFile);

/** Bump together with the release the asset names/checksums were taken from. */
export const CLOUDFLARED_VERSION = "2026.9.1";
const CLOUDFLARED_RELEASE_API = `https://api.github.com/repos/cloudflare/cloudflared/releases/tags/${CLOUDFLARED_VERSION}`;

/** Give up on a start attempt that never prints a URL. */
const START_TIMEOUT_MS = 45_000;
/** Watchdog interval while the tunnel is supposed to be up. */
const WATCH_INTERVAL_MS = 15_000;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 120_000;

export type CloudflareTunnelStatus = {
  /** User wants public access; install/start may still be in flight. */
  enabled: boolean;
  /** cloudflared binary present and executable-ready. */
  installed: boolean;
  /** cloudflared process running. */
  running: boolean;
  /** Current step while bringing the tunnel up. */
  phase: "off" | "downloading" | "starting" | "on" | "error";
  /** Public trycloudflare URL once the tunnel is up. */
  url: string | null;
  /** Last failure, kept so the settings panel can explain what went wrong. */
  error: string | null;
  /** The loopback origin the tunnel forwards to. */
  origin: string | null;
  /** Where the binary lives (or is expected to live). */
  binaryPath: string;
  /** True when the user pointed us at their own cloudflared build. */
  customBinary: boolean;
};

type Options = {
  /** Manual cloudflared path from settings; empty ⇒ managed download. */
  customPath?: string;
  /** Managed download allowed (settings default true). */
  autoDownload?: boolean;
};

let child: ChildProcessWithoutNullStreams | null = null;
let opts: Required<Options> = { customPath: "", autoDownload: true };
let origin: string | null = null;
let publicUrl: string | null = null;
let stopped = true;
let starting = false;
let phase: CloudflareTunnelStatus["phase"] = "off";
let lastError: string | null = null;
let retryAttempt = 0;
let retryTimer: NodeJS.Timeout | null = null;
let watchdog: NodeJS.Timeout | null = null;
let startTimer: NodeJS.Timeout | null = null;
let downloading: Promise<string> | null = null;
/** Origin port of the current attempt, reused by automatic retries. */
let originPortRef: number | null = null;
/** True once cloudflared actually spawned during the current attempt. */
let everSpawned = false;

const listeners = new Set<(status: CloudflareTunnelStatus) => void>();

function notify(): void {
  const snapshot = getTunnelStatus();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch {
      // a broken listener must never break the tunnel
    }
  }
}

export function onTunnelStatusChange(cb: (status: CloudflareTunnelStatus) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function binaryDir(): string {
  return join(app.getPath("userData"), "cloudflared", CLOUDFLARED_VERSION);
}

function managedBinaryPath(): string {
  return join(binaryDir(), process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
}

/** Resolve which cloudflared to use: the manual override wins when it exists. */
export function resolveCloudflaredPath(options: Options = {}): string | null {
  const custom = String(options.customPath ?? opts.customPath ?? "").trim();
  if (custom && existsSync(custom)) return custom;
  const managed = managedBinaryPath();
  return existsSync(managed) ? managed : null;
}

export function applyTunnelOptions(options: Options): void {
  opts = {
    customPath: String(options.customPath ?? "").trim(),
    autoDownload: options.autoDownload !== false,
  };
}

export function isTunnelInstalled(): boolean {
  return resolveCloudflaredPath() !== null;
}

export function getTunnelStatus(): CloudflareTunnelStatus {
  const binary = resolveCloudflaredPath();
  return {
    enabled: !stopped || starting,
    installed: binary !== null,
    running: Boolean(child) && child?.killed !== true,
    phase,
    url: publicUrl,
    error: lastError,
    origin,
    binaryPath: binary ?? managedBinaryPath(),
    customBinary: Boolean(opts.customPath) && binary === opts.customPath,
  };
}

/** Prefer Chromium's stack (proxy/TLS aware), fall back to plain fetch. */
async function netFetch(url: string): Promise<Response> {
  const init: RequestInit = {
    redirect: "follow",
    headers: { "User-Agent": `pi-desktop/${app.getVersion()}` },
  };
  try {
    return await net.fetch(url, init);
  } catch (err) {
    try {
      return await fetch(url, init);
    } catch {
      throw err;
    }
  }
}

/** Streaming download that returns the SHA-256 of what landed on disk. */
async function downloadFile(url: string, dest: string): Promise<string> {
  const tmp = `${dest}.part`;
  rmSync(tmp, { force: true });
  const res = await netFetch(url);
  if (!res.ok || !res.body) throw new Error(`下载 cloudflared 失败（HTTP ${res.status}）`);
  const hash = createHash("sha256");
  const stream = Readable.fromWeb(res.body as import("stream/web").ReadableStream);
  stream.on("data", (chunk: Buffer) => hash.update(chunk));
  await pipeline(stream, createWriteStream(tmp));
  if (statSync(tmp).size < 1_000_000) {
    rmSync(tmp, { force: true });
    throw new Error("下载的 cloudflared 文件不完整");
  }
  rmSync(dest, { force: true });
  renameSync(tmp, dest);
  return hash.digest("hex");
}

/**
 * Official SHA-256 for the asset, read from the release notes. A missing
 * checksum is not fatal (Cloudflare could reformat the notes), but a *mismatch*
 * always is.
 */
async function fetchExpectedSha256(asset: string): Promise<string | null> {
  try {
    const res = await netFetch(CLOUDFLARED_RELEASE_API);
    if (!res.ok) return null;
    const release = (await res.json()) as { body?: string };
    return findAssetSha256(release.body ?? "", asset);
  } catch {
    return null;
  }
}

async function extractArchive(
  archivePath: string,
  destDir: string,
  kind: "zip" | "tar.gz",
): Promise<void> {
  mkdirSync(destDir, { recursive: true });
  if (process.platform === "win32" && kind === "zip") {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
      ],
      { windowsHide: true },
    );
    return;
  }
  await execFileAsync("tar", [kind === "tar.gz" ? "-xzf" : "-xf", archivePath, "-C", destDir]);
}

/** Download + unpack cloudflared once (concurrent callers share one promise). */
export async function ensureCloudflaredInstalled(): Promise<string> {
  const existing = resolveCloudflaredPath();
  if (existing) return existing;
  if (!opts.autoDownload) throw new Error("未找到 cloudflared，请手动指定路径或允许自动下载");
  if (downloading) return downloading;

  const asset = cloudflaredAsset();
  if (!asset) {
    throw new Error(`当前平台不支持自动安装 cloudflared（${process.platform}/${process.arch}）`);
  }

  downloading = (async (): Promise<string> => {
    const dir = binaryDir();
    mkdirSync(dir, { recursive: true });
    const kind = cloudflaredArchiveKind(asset.asset);
    const downloadPath = join(dir, kind === "none" ? "cloudflared.download" : `cloudflared.${kind === "zip" ? "zip" : "tgz"}`);
    const expected = await fetchExpectedSha256(asset.asset);
    phase = "downloading";
    lastError = null;
    notify();
    try {
      const actual = await downloadFile(cloudflaredDownloadUrl(asset.asset, CLOUDFLARED_VERSION), downloadPath);
      if (expected && expected !== actual) {
        rmSync(downloadPath, { force: true });
        throw new Error(`cloudflared 校验失败（期望 ${expected.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…）`);
      }
      rmSync(managedBinaryPath(), { force: true });
      if (kind === "none") {
        renameSync(downloadPath, managedBinaryPath());
      } else {
        await extractArchive(downloadPath, dir, kind);
      }
      const bin = managedBinaryPath();
      if (!existsSync(bin)) throw new Error("解压后未找到 cloudflared 可执行文件");
      try {
        chmodSync(bin, 0o755);
      } catch {
        // Windows: no-op
      }
      return bin;
    } finally {
      rmSync(downloadPath, { force: true });
      downloading = null;
    }
  })();

  return downloading;
}

function clearStartTimer(): void {
  if (startTimer) clearTimeout(startTimer);
  startTimer = null;
}

/** Startup errors worth retrying on a timer; user-fixable ones are not. */
function isTransientStartError(message: string): boolean {
  return !/未找到 cloudflared|不支持自动安装|下载 cloudflared 失败|文件不完整|校验失败/u.test(message);
}

function scheduleRetry(reason: string): void {
  if (stopped || retryTimer) return;
  retryAttempt += 1;
  const delay = Math.min(RETRY_BASE_MS * 2 ** (retryAttempt - 1), RETRY_MAX_MS);
  lastError = `${reason}（${Math.round(delay / 1000)} 秒后重试）`;
  phase = "error";
  notify();
  const port = originPortRef;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (port) void startTunnel(port, {});
  }, delay);
}

/** Spawn cloudflared and resolve once it prints its public URL. */
async function spawnTunnel(bin: string, originUrl: string): Promise<void> {
  const proc = spawn(bin, ["tunnel", "--url", originUrl, "--no-autoupdate"], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = proc;
  everSpawned = true;
  origin = originUrl;
  phase = "starting";
  notify();

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      clearStartTimer();
      if (err) reject(err);
      else resolve();
    };

    const onChunk = (chunk: Buffer): void => {
      const url = parseQuickTunnelUrl(chunk.toString("utf8"));
      if (!url) return;
      publicUrl = url;
      phase = "on";
      retryAttempt = 0;
      lastError = null;
      notify();
      finish();
    };

    proc.stderr.on("data", onChunk);
    proc.stdout.on("data", onChunk);
    proc.once("error", (err) => finish(err instanceof Error ? err : new Error(String(err))));
    proc.once("exit", (code) => {
      if (child === proc) {
        child = null;
        publicUrl = null;
      }
      finish(new Error(`cloudflared 已退出（code ${code ?? "null"}）`));
    });

    startTimer = setTimeout(() => {
      finish(new Error("cloudflared 启动超时，未获取到公网地址"));
    }, START_TIMEOUT_MS);
  });
}

function killChild(): void {
  const proc = child;
  child = null;
  publicUrl = null;
  if (!proc) return;
  try {
    proc.removeAllListeners("exit");
    proc.kill();
  } catch {
    // ignore
  }
}

/**
 * Watchdog for a tunnel that silently dies after a successful start.
 *
 * It must NOT fire before the process has ever been spawned: installing
 * cloudflared can take minutes on a slow link, and the earlier "no child ⇒
 * retry" version aborted the download mid-flight and left no binary behind.
 * `everSpawned` records that cloudflared really ran for this attempt, so a
 * vanished process afterwards is a genuine failure worth retrying.
 */
function startWatchdog(): void {
  if (watchdog) return;
  watchdog = setInterval(() => {
    if (stopped || retryTimer || downloading || !everSpawned) return;
    if (!child) scheduleRetry("cloudflared 未在运行");
  }, WATCH_INTERVAL_MS);
}

/**
 * Turn public access on. `originPort` is the loopback-only HTTP port served by
 * the remote-control host; the tunnel is what gives that plain-HTTP origin a
 * real HTTPS address, with TLS terminated at Cloudflare's edge.
 */
export async function startTunnel(
  originPort: number,
  options: Options,
): Promise<CloudflareTunnelStatus> {
  applyTunnelOptions(options);
  originPortRef = Number.isInteger(originPort) && originPort > 0 ? originPort : null;
  const originUrl = `http://127.0.0.1:${originPort}`;
  if (child && origin === originUrl && phase === "on") return getTunnelStatus();
  if (!originPortRef) {
    stopped = true;
    phase = "error";
    lastError = "内部端口无效";
    notify();
    return getTunnelStatus();
  }

  stopped = false;
  starting = true;
  lastError = null;
  phase = "starting";
  // NOTE: retryAttempt is deliberately NOT reset here — startTunnel is itself
  // called by the retry timer, and resetting it would turn the exponential
  // backoff into a 5-second loop. It resets on a successful start.
  everSpawned = false;
  notify();
  startWatchdog();

  // A previous attempt (or a different origin) must not linger.
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  killChild();

  try {
    const bin = await ensureCloudflaredInstalled();
    await spawnTunnel(bin, originUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lastError = msg;
    phase = "error";
    killChild();
    notify();
    if (isTransientStartError(msg)) scheduleRetry(msg);
  } finally {
    starting = false;
    notify();
  }
  return getTunnelStatus();
}

/** Turn public access off and tear the tunnel down. */
export function stopTunnel(): void {
  stopped = true;
  starting = false;
  phase = "off";
  publicUrl = null;
  origin = null;
  retryAttempt = 0;
  originPortRef = null;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  clearStartTimer();
  killChild();
  notify();
}

/** Called on app quit — never leave a stray tunnel process behind. */
export function disposeTunnel(): void {
  stopTunnel();
  if (watchdog) {
    clearInterval(watchdog);
    watchdog = null;
  }
  listeners.clear();
}

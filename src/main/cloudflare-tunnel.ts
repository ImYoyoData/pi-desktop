/**
 * Public access for "远程控制" (Remote Control) — Cloudflare tunnels.
 *
 * The tunnel process itself is owned by the `cloudflared` npm package (its
 * `Tunnel` class is a thin, well-tested spawn wrapper); this module owns the
 * lifecycle policy around it: binary readiness, the URL/connection timeout,
 * crash-restart backoff, a watchdog, and the grace window that keeps a stopped
 * tunnel alive so a quick off→on toggle reuses the same public hostname.
 *
 * Two modes, picked by the caller (see lan-console):
 * - **quick** — accountless `https://<words>.trycloudflare.com`, whose hostname is
 *   minted per start and therefore changes on every restart.
 * - **named** — the user's own Cloudflare tunnel token plus the public hostname
 *   they configured in the Cloudflare dashboard. The hostname is FIXED, which is
 *   the only way to keep one bookmark across restarts.
 *
 * Both leave cloudflared's transport protocol at its default (`auto`): forcing
 * `--protocol http2` was measured to make quick tunnels unreachable on this
 * network while `auto` connected in seconds. See SHARED_TUNNEL_FLAGS.
 */

import { Tunnel } from "cloudflared";
import { parseQuickTunnelUrl } from "../shared/cloudflare-tunnel";
import {
  CLOUDFLARED_VERSION,
  applyBinaryToPackage,
  bundledCandidates,
  ensureRunnableBinary,
  namedTunnelArgs,
  quickTunnelFlags,
} from "./cloudflared-binary";

/** Give up on a start attempt that never reports a URL / connection. */
const START_TIMEOUT_MS = 45_000;
/** Watchdog interval while the tunnel is supposed to be up. */
const WATCH_INTERVAL_MS = 15_000;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 120_000;

export type TunnelMode = "quick" | "named";

export type CloudflareTunnelStatus = {
  /** User wants public access; install/start may still be in flight. */
  enabled: boolean;
  /** A usable cloudflared executable was resolved. */
  installed: boolean;
  /** cloudflared process running. */
  running: boolean;
  /** Current step while bringing the tunnel up. */
  phase: "off" | "downloading" | "starting" | "on" | "error";
  /** Public URL (quick: minted by Cloudflare; named: the configured hostname). */
  url: string | null;
  /** Last failure, kept so the settings panel can explain what went wrong. */
  error: string | null;
  /** The loopback origin the tunnel forwards to. */
  origin: string | null;
  /** Which mode is running (or about to run). */
  mode: TunnelMode;
  /** Where the binary lives (or is expected to live). */
  binaryPath: string;
  /** True when the user pointed us at their own cloudflared build. */
  customBinary: boolean;
};

export type TunnelTarget =
  | { kind: "quick"; targetUrl: string }
  | { kind: "named"; token: string; publicUrl: string };

type Options = {
  /** Manual cloudflared path from settings; empty ⇒ bundled / userData / download. */
  customPath?: string;
  /** Managed download allowed when nothing usable is bundled. */
  autoDownload?: boolean;
  /** Cloudflare tunnel token; non-empty switches to the named-tunnel mode. */
  tunnelToken?: string;
  /** Public hostname to advertise for a named tunnel (from settings). */
  publicUrl?: string;
};

let current: Tunnel | null = null;
let target: TunnelTarget | null = null;
let opts: Required<Options> = { customPath: "", autoDownload: true, tunnelToken: "", publicUrl: "" };
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
let ensureInFlight: Promise<{ path: string }> | null = null;
/** Origin port of the current attempt, reused by automatic retries. */
let originPortRef: number | null = null;
/** True once a tunnel process actually spawned during the current attempt. */
let everSpawned = false;
let binaryPathCache = "";
let binaryCustom = false;

const listeners = new Set<(status: CloudflareTunnelStatus) => void>();

export function onTunnelStatusChange(cb: (status: CloudflareTunnelStatus) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

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

/** Compare two targets for the start-idempotence check. */
function sameTarget(a: TunnelTarget | null, b: TunnelTarget): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b);
}

export function getTunnelStatus(): CloudflareTunnelStatus {
  return {
    enabled: !stopped || starting,
    installed: Boolean(binaryPathCache),
    running: current !== null,
    phase,
    url: publicUrl,
    error: lastError,
    origin,
    mode: target?.kind ?? "quick",
    binaryPath: binaryPathCache || bundledCandidates()[0] || "",
    customBinary: binaryCustom,
  };
}

export function isTunnelInstalled(): boolean {
  return Boolean(binaryPathCache);
}

export function applyTunnelOptions(options: Options): void {
  opts = {
    customPath: String(options.customPath ?? "").trim(),
    autoDownload: options.autoDownload !== false,
    tunnelToken: String(options.tunnelToken ?? "").trim(),
    publicUrl: String(options.publicUrl ?? "").trim(),
  };
}

/**
 * Decide what to run. A named tunnel wins whenever a token is configured: it is
 * the only mode with a stable public hostname, which is the whole point of
 * configuring one. Otherwise the accountless quick tunnel runs.
 */
export function tunnelTargetOf(options: {
  tunnelToken?: string;
  publicUrl?: string;
  originPort: number;
}): TunnelTarget {
  const token = String(options.tunnelToken ?? "").trim();
  if (token) {
    return { kind: "named", token, publicUrl: String(options.publicUrl ?? "").trim() };
  }
  return { kind: "quick", targetUrl: `http://127.0.0.1:${options.originPort}` };
}

/** Resolve + validate the binary once, then point the package at it. */
async function ensureBinary(): Promise<string> {
  if (binaryPathCache) return binaryPathCache;
  if (!ensureInFlight) {
    ensureInFlight = ensureRunnableBinary(opts.customPath, opts.autoDownload)
      .then((resolved) => {
        binaryPathCache = resolved.path;
        binaryCustom = Boolean(opts.customPath) && resolved.path === opts.customPath;
        return { path: resolved.path };
      })
      .finally(() => {
        ensureInFlight = null;
      });
  }
  const resolved = await ensureInFlight;
  return resolved.path;
}

function clearStartTimer(): void {
  if (startTimer) clearTimeout(startTimer);
  startTimer = null;
}

/** Startup errors worth retrying on a timer; user-fixable ones are not. */
function isTransientStartError(message: string): boolean {
  return !/未找到|不支持|校验失败|does not run|无法运行/u.test(message);
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
    if (port) void startTunnel(port, opts.publicUrl ? opts : opts);
  }, delay);
}

/** Build the spawn invocation for a target through the cloudflared package. */
function spawnTunnelProcess(next: TunnelTarget): Tunnel {
  if (next.kind === "quick") {
    // quickTunnelFlags carries --no-autoupdate (protocol stays `auto`).
    return Tunnel.quick(next.targetUrl, quickTunnelFlags());
  }
  // Named tunnels need the flags BEFORE the `run` subcommand, which is why the
  // package's withToken() (which appends --token to a plain options object) is
  // not used here; the package still spawns and streams the process.
  return new Tunnel(namedTunnelArgs(next.token));
}

/** Spawn the tunnel and resolve once it is reachable (URL or first connection). */
async function spawnTunnel(next: TunnelTarget): Promise<void> {
  const proc = spawnTunnelProcess(next);
  current = proc;
  everSpawned = true;
  origin = next.kind === "quick" ? next.targetUrl : origin;
  phase = "starting";
  notify();

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      clearStartTimer();
      resolve0(err);
    };
    const resolve0 = (err?: Error): void => {
      if (err) reject(err);
      else resolve();
    };

    const markUp = (url: string): void => {
      if (current !== proc) return;
      publicUrl = url;
      phase = "on";
      retryAttempt = 0;
      lastError = null;
      notify();
      finish();
    };

    const onUrl = (url: string): void => {
      markUp(url);
    };
    const onConnected = (): void => {
      // Named tunnels have no minted URL: the hostname comes from the user's
      // Cloudflare config, and the first edge connection means it is reachable.
      const advertised = next.kind === "named" ? next.publicUrl : null;
      if (advertised) markUp(advertised);
    };
    const onStderr = (chunk: string): void => {
      // The package re-emits raw output; keep the quick-tunnel banner as a
      // fallback in case the `url` event never fires for a given build.
      if (next.kind !== "quick" || publicUrl) return;
      const parsed = parseQuickTunnelUrl(chunk);
      if (parsed) markUp(parsed);
    };

    proc.on("url", onUrl);
    proc.on("connected", onConnected);
    proc.on("stderr", onStderr);
    proc.on("error", (err: Error) => finish(err));
    proc.on("exit", (code) => {
      if (current === proc) {
        current = null;
        publicUrl = null;
      }
      finish(new Error(`cloudflared 已退出（code ${code ?? "null"}）`));
    });

    startTimer = setTimeout(() => {
      finish(new Error("cloudflared 启动超时，未获得公网地址"));
    }, START_TIMEOUT_MS);
  });
}

function killTunnelProcess(): void {
  const proc = current;
  current = null;
  publicUrl = null;
  if (!proc) return;
  try {
    proc.removeAllListeners("exit");
    proc.removeAllListeners("error");
    proc.stop();
  } catch {
    // ignore
  }
}

/**
 * Watchdog for a tunnel that silently dies after a successful start.
 * It must not fire before the process has ever been spawned: resolving the
 * binary can take minutes on a slow link, and a premature retry used to abort
 * that work mid-flight.
 */
function startWatchdog(): void {
  if (watchdog) return;
  watchdog = setInterval(() => {
    if (stopped || retryTimer || ensureInFlight || !everSpawned) return;
    if (!current) scheduleRetry("cloudflared 未在运行");
  }, WATCH_INTERVAL_MS);
}

/**
 * Turn public access on. `originPort` is the loopback-only HTTP port served by the
 * remote-control host; the tunnel is what gives that plain-HTTP origin a real
 * public address, with TLS terminated at Cloudflare's edge.
 */
export async function startTunnel(
  originPort: number,
  options: Options,
): Promise<CloudflareTunnelStatus> {
  applyTunnelOptions(options);
  originPortRef = Number.isInteger(originPort) && originPort > 0 ? originPort : null;
  if (!originPortRef) {
    stopped = true;
    phase = "error";
    lastError = "内部端口无效";
    notify();
    return getTunnelStatus();
  }

  const next = tunnelTargetOf({
    tunnelToken: opts.tunnelToken,
    publicUrl: opts.publicUrl,
    originPort,
  });

  if (next.kind === "named" && !next.token) {
    stopped = true;
    phase = "error";
    lastError = "未配置隧道 Token";
    notify();
    return getTunnelStatus();
  }
  if (current && sameTarget(target, next) && phase === "on") return getTunnelStatus();

  stopped = false;
  starting = true;
  lastError = null;
  phase = "starting";
  // NOTE: retryAttempt is deliberately NOT reset here — startTunnel is itself
  // called by the retry timer, and resetting it would turn the exponential
  // backoff into a fixed 5-second loop. It resets on a successful start.
  everSpawned = false;
  target = next;
  notify();
  startWatchdog();

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  killTunnelProcess();

  try {
    binaryPathCache = await ensureBinary();
    applyBinaryToPackage(binaryPathCache);
    await spawnTunnel(next);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lastError = msg;
    phase = "error";
    killTunnelProcess();
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
  target = null;
  retryAttempt = 0;
  originPortRef = null;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  clearStartTimer();
  killTunnelProcess();
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

/** Name of the cloudflared release the app expects (diagnostics / UI copy). */
export const EXPECTED_CLOUDFLARED_VERSION = CLOUDFLARED_VERSION;

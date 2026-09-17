/**
 * cloudflared binary acquisition for the remote-control public tunnel.
 *
 * The lifecycle itself comes from the `cloudflared` npm package (see
 * cloudflare-tunnel.ts). This module answers only "which executable should that
 * package spawn, and is it actually runnable here":
 *
 * 1. Our own proxy-aware build prefetch downloads it into
 *    `resources/cloudflared/<version>/` (checksum-verified) so the packaged app
 *    never has to download anything at runtime.
 * 2. A previously downloaded copy under userData is reused.
 * 3. As a last resort the package's own `install()` runs — note that its
 *    downloader uses bare `node:https`, so it ignores system proxies; that is
 *    exactly why the build-time prefetch exists.
 *
 * `applyBinaryToPackage()` then points the package at whatever we found, since
 * the package resolves its binary from ITS OWN `bin/` directory by default.
 */

import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import { bin as packageBin, use as usePackageBinary } from "cloudflared";
import {
  type BinaryLayout,
  cloudflaredCandidates,
  isSpawnablePath,
  pickCloudflaredPath,
} from "../shared/cloudflared-path";
import { netFetch } from "./net-fetch";

/** cloudflared release the build prefetches. Keep in sync with the fetch script. */
export const CLOUDFLARED_VERSION = "2026.9.1";

/** Time box for the `--version` probe. */
const PROBE_TIMEOUT_MS = 10_000;

export function binaryFileName(): string {
  return process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
}

/**
 * True when `candidate` is a real on-disk file we could execute.
 *
 * The asar rejection inside `isSpawnablePath` is what makes this safe: Electron
 * patches `fs` so paths inside `app.asar` report as existing, but such a file
 * cannot be spawned — a packaged build "found" one and then failed with ENOENT.
 */
export function isRunnableFile(candidate: string): boolean {
  return isSpawnablePath(candidate, statSync);
}

function currentLayout(): BinaryLayout {
  return {
    platform: process.platform,
    arch: process.arch,
    resourcesPath: process.resourcesPath,
    execPath: process.execPath,
    bundleDir: __dirname,
  };
}

/** Candidate paths for the build-prefetched binary, most specific first. */
export function bundledCandidates(): string[] {
  return cloudflaredCandidates(CLOUDFLARED_VERSION, currentLayout());
}

/** Build-prefetched binary, or null when this build does not ship one. */
export function bundledCloudflaredPath(): string | null {
  return pickCloudflaredPath(CLOUDFLARED_VERSION, currentLayout(), statSync);
}

/** Copy downloaded by an earlier run of this app (used when node_modules is read-only). */
function userDataBinaryPath(): string {
  return join(app.getPath("userData"), "cloudflared", CLOUDFLARED_VERSION, binaryFileName());
}

async function fetchCloudflaredAsset(url: string): Promise<Response> {
  return netFetch(url, { redirect: "follow", headers: { "User-Agent": "pi-desktop" } });
}

/** Release asset name for this platform/arch. */
function assetName(): string {
  const a = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : "";
  if (!a) throw new Error(`不支持的架构：${process.arch}`);
  if (process.platform === "win32") return `cloudflared-windows-${a}.exe`;
  if (process.platform === "darwin") return `cloudflared-darwin-${a}.tgz`;
  if (process.platform === "linux") return a === "arm64" ? "cloudflared-linux-arm64" : `cloudflared-linux-${a}`;
  throw new Error(`不支持的系统：${process.platform}`);
}

async function downloadBinary(dest: string): Promise<void> {
  const url = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${assetName()}`;
  const res = await fetchCloudflaredAsset(url);
  if (!res.ok || !res.body) throw new Error(`下载 cloudflared 失败（HTTP ${res.status}）`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 1_000_000) throw new Error(`下载内容过小（${buffer.length} bytes）`);
  if (url.endsWith(".tgz")) {
    // macOS ships a tarball containing the binary.
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { writeFileSync, rmSync } = await import("node:fs");
    const tmp = `${dest}.tgz`;
    writeFileSync(tmp, buffer);
    await promisify(execFile)("tar", ["-xzf", tmp, "-C", dirname(dest)]);
    rmSync(tmp, { force: true });
  } else {
    writeFileSync(dest, buffer);
  }
  if (process.platform !== "win32") {
    try {
      chmodSync(dest, 0o755);
    } catch {
      /* ignore */
    }
  }
  if (!isRunnableFile(dest)) throw new Error(`下载后文件不可用：${dest}`);
}

/**
 * Probe that the binary actually EXECUTES here.
 *
 * Existence is not enough: the build may have staged a binary for another
 * OS/arch, which only shows up as a spawn failure at connect time. Running
 * `--version` catches that up front.
 */
export function binaryRuns(executable: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, ["--version"], { stdio: "ignore", windowsHide: true });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      done(false);
    }, PROBE_TIMEOUT_MS);
    child.once("error", () => done(false));
    child.once("exit", (code) => done(code === 0));
  });
}

export type BinarySource = "bundled" | "userData" | "package" | "downloaded";

export type ResolvedBinary = { path: string; source: BinarySource };

/** Binary already proven runnable in this process (the probe is not free). */
const validated = new Set<string>();

/** Resolve a binary without executing anything. */
export function locateBinary(customPath = ""): ResolvedBinary | null {
  const custom = customPath.trim();
  if (custom && isRunnableFile(custom)) return { path: custom, source: "userData" };
  const bundled = bundledCloudflaredPath();
  if (bundled) return { path: bundled, source: "bundled" };
  // The `cloudflared` package's own copy (its postinstall downloads here). It is
  // inside node_modules, so electron-builder ships it in the installer.
  if (isRunnableFile(packageBin)) return { path: packageBin, source: "package" };
  if (isRunnableFile(userDataBinaryPath())) return { path: userDataBinaryPath(), source: "userData" };
  return null;
}

/**
 * Hand the package the executable we resolved, then verify it runs. When nothing
 * usable exists and downloads are allowed, fetch a copy (proxy-aware) — preferring
 * the package's own bin path so a later packaging step can bundle it.
 */
export async function ensureRunnableBinary(
  customPath = "",
  allowDownload = true,
): Promise<ResolvedBinary> {
  const resolved = locateBinary(customPath);
  if (resolved && (validated.has(resolved.path) || (await binaryRuns(resolved.path)))) {
    validated.add(resolved.path);
    usePackageBinary(resolved.path);
    return resolved;
  }
  if (resolved) {
    // Present but not runnable (wrong arch / truncated): fall through and re-fetch.
    console.warn(`[remote-control] cloudflared at ${resolved.path} does not run; re-fetching`);
  }
  if (!allowDownload) {
    throw new Error(
      `未找到可用的 cloudflared（已尝试：${bundledCandidates()[0] ?? "n/a"}）`,
    );
  }

  // Prefer the package's bin path (ships with the app); fall back to userData when
  // that location is not writable (packaged app: node_modules lives in the asar).
  const candidates = [packageBin, userDataBinaryPath()];
  let lastError: unknown;
  for (const dest of candidates) {
    try {
      mkdirSync(dirname(dest), { recursive: true });
      await downloadBinary(dest);
      if (!(await binaryRuns(dest))) throw new Error(`cloudflared 无法运行：${dest}`);
      validated.add(dest);
      usePackageBinary(dest);
      return { path: dest, source: "downloaded" };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `无法获取 cloudflared：${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/** Point the package at a path we already trust (also used by tests). */
export function applyBinaryToPackage(executable: string): void {
  usePackageBinary(executable);
}

// Re-exported so the tunnel manager has a single import site; the definitions
// live in shared/ so they stay unit-testable without Electron.
export { SHARED_TUNNEL_FLAGS, namedTunnelArgs, quickTunnelFlags } from "../shared/cloudflare-tunnel";

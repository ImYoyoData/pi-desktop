import { app, BrowserWindow, ipcMain, net, shell } from "electron";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "fs";
import { join } from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
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

let checking = false;
let downloading = false;
let cachedRelease: GhRelease | null = null;

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

/** Prefer Chromium network stack — better proxy/TLS than Node fetch in Electron. */
async function electronFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await net.fetch(url, init);
  } catch (err) {
    // Fall back to global fetch if net.fetch is unavailable / blocked.
    try {
      return await fetch(url, init);
    } catch {
      throw err;
    }
  }
}

async function fetchLatestRelease(): Promise<GhRelease> {
  // Prefer releases list: GitHub `/releases/latest` excludes prereleases and
  // returns 404 when the newest (or only) release is marked prerelease.
  const res = await electronFetch(APP_GITHUB_API_RELEASES, {
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

async function downloadAsset(
  url: string,
  dest: string,
  onProgress?: (received: number, total: number | null) => void,
): Promise<void> {
  const tmp = `${dest}.part`;
  rmSync(tmp, { force: true });

  const res = await electronFetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": `pi-desktop/${currentVersion()}`,
      Accept: "application/octet-stream",
    },
  });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (HTTP ${res.status})`);
  }
  const total = Number(res.headers.get("content-length") || 0) || null;
  let received = 0;
  const reader = Readable.fromWeb(res.body as import("stream/web").ReadableStream);
  const out = createWriteStream(tmp);
  reader.on("data", (chunk: Buffer) => {
    received += chunk.length;
    onProgress?.(received, total);
  });
  await pipeline(reader, out);
  rmSync(dest, { force: true });
  renameSync(tmp, dest);
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
  broadcastUpdateProgress({
    phase: "download",
    receivedBytes: 0,
    totalBytes: asset.size || null,
    message: `Downloading ${asset.name}…`,
  });

  const dest = join(downloadDir(), asset.name);
  try {
    await downloadAsset(asset.browser_download_url, dest, (received, total) => {
      broadcastUpdateProgress({
        phase: "download",
        receivedBytes: received,
        totalBytes: total ?? asset.size ?? null,
        message: `Downloading ${asset.name}…`,
      });
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    broadcastUpdateProgress({
      phase: "error",
      receivedBytes: 0,
      totalBytes: null,
      message: msg,
    });
    await openReleaseInBrowser(release.html_url);
    downloading = false;
    return emptyUpdateResult(
      "openedBrowser",
      cur,
      `Auto-download failed — opened browser (${msg})`,
      { ...meta, assetName: asset.name },
    );
  } finally {
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
}

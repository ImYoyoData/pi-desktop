import { app, BrowserWindow, ipcMain, shell } from "electron";
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
  isNewerVersion,
  pickReleaseAsset,
  type GhRelease,
  type UpdateCheckResult,
} from "../shared/update";

let checking = false;
let downloading = false;

function currentVersion(): string {
  return app.getVersion();
}

function downloadDir(): string {
  const dir = join(app.getPath("temp"), "pi-desktop-updates");
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function fetchLatestRelease(): Promise<GhRelease> {
  // Prefer releases list: GitHub `/releases/latest` excludes prereleases and
  // returns 404 when the newest (or only) release is marked prerelease.
  const res = await fetch(APP_GITHUB_API_RELEASES, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `pi-desktop/${currentVersion()}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub Releases 请求失败 (${res.status})`);
  }
  const list = (await res.json()) as GhRelease[];
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("暂无可用的 GitHub Release");
  }
  const release = list.find((r) => !r.draft);
  if (!release) {
    throw new Error("暂无可用的 GitHub Release");
  }
  return release;
}

async function downloadAsset(
  url: string,
  dest: string,
  onProgress?: (received: number, total: number | null) => void,
): Promise<void> {
  const tmp = `${dest}.part`;
  rmSync(tmp, { force: true });
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": `pi-desktop/${currentVersion()}`, Accept: "*/*" },
  });
  if (!res.ok || !res.body) {
    throw new Error(`下载失败 (HTTP ${res.status})`);
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

function broadcastUpdateProgress(payload: {
  phase: "download" | "done" | "error";
  receivedBytes: number;
  totalBytes: number | null;
  message: string;
}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.update.progress, payload);
  }
}

async function openReleaseInBrowser(url?: string | null): Promise<void> {
  await shell.openExternal(url || APP_RELEASES_URL);
}

/**
 * Check latest GitHub Release. When `download` is true and a matching asset
 * exists, download it and open the installer; otherwise open the release page.
 */
export async function checkForAppUpdate(options?: {
  download?: boolean;
  silent?: boolean;
}): Promise<UpdateCheckResult> {
  const download = options?.download !== false;
  const cur = currentVersion();

  if (checking || downloading) {
    return {
      status: "error",
      currentVersion: cur,
      latestVersion: null,
      releaseUrl: null,
      assetName: null,
      message: "更新检查已在进行中",
    };
  }

  checking = true;
  try {
    const release = await fetchLatestRelease();
    if (release.draft) {
      return {
        status: "upToDate",
        currentVersion: cur,
        latestVersion: null,
        releaseUrl: APP_RELEASES_URL,
        assetName: null,
        message: "暂无正式发布版本",
      };
    }

    const latest = release.tag_name.replace(/^v/i, "");
    if (!isNewerVersion(latest, cur)) {
      return {
        status: "upToDate",
        currentVersion: cur,
        latestVersion: latest,
        releaseUrl: release.html_url,
        assetName: null,
        message: `已是最新版本 v${cur}`,
      };
    }

    const asset = pickReleaseAsset(release.assets ?? [], process.platform, process.arch);
    if (!download || !asset) {
      await openReleaseInBrowser(release.html_url);
      return {
        status: "openedBrowser",
        currentVersion: cur,
        latestVersion: latest,
        releaseUrl: release.html_url,
        assetName: asset?.name ?? null,
        message: asset
          ? `发现 v${latest}，已打开发布页`
          : `发现 v${latest}，当前系统暂无匹配安装包，已打开发布页`,
      };
    }

    downloading = true;
    broadcastUpdateProgress({
      phase: "download",
      receivedBytes: 0,
      totalBytes: asset.size || null,
      message: `正在下载 ${asset.name}…`,
    });

    const dest = join(downloadDir(), asset.name);
    try {
      await downloadAsset(asset.browser_download_url, dest, (received, total) => {
        broadcastUpdateProgress({
          phase: "download",
          receivedBytes: received,
          totalBytes: total ?? asset.size ?? null,
          message: `正在下载 ${asset.name}…`,
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
      return {
        status: "openedBrowser",
        currentVersion: cur,
        latestVersion: latest,
        releaseUrl: release.html_url,
        assetName: asset.name,
        message: `自动下载失败，已打开浏览器：${msg}`,
      };
    } finally {
      downloading = false;
    }

    if (!existsSync(dest)) {
      await openReleaseInBrowser(release.html_url);
      return {
        status: "openedBrowser",
        currentVersion: cur,
        latestVersion: latest,
        releaseUrl: release.html_url,
        assetName: asset.name,
        message: "下载文件丢失，已打开发布页",
      };
    }

    const openErr = await shell.openPath(dest);
    if (openErr) {
      await openReleaseInBrowser(release.html_url);
      return {
        status: "openedBrowser",
        currentVersion: cur,
        latestVersion: latest,
        releaseUrl: release.html_url,
        assetName: asset.name,
        message: `无法打开安装包（${openErr}），已打开发布页`,
      };
    }

    broadcastUpdateProgress({
      phase: "done",
      receivedBytes: asset.size || 0,
      totalBytes: asset.size || null,
      message: "已启动安装程序",
    });

    return {
      status: "downloaded",
      currentVersion: cur,
      latestVersion: latest,
      releaseUrl: release.html_url,
      assetName: asset.name,
      message: `已下载并打开 v${latest} 安装包，请按提示完成更新`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await openReleaseInBrowser(APP_RELEASES_URL);
    } catch {
      // ignore
    }
    return {
      status: "error",
      currentVersion: cur,
      latestVersion: null,
      releaseUrl: APP_RELEASES_URL,
      assetName: null,
      message: `检查更新失败：${msg}`,
    };
  } finally {
    checking = false;
  }
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
    return checkForAppUpdate({ download: opts?.download !== false });
  });
}

import { app, BrowserWindow, ipcMain, shell } from "electron";
import { IpcChannels } from "../shared/protocol";
import {
	APP_AUTHOR,
	APP_AUTHOR_EMAIL,
	APP_AUTHOR_QQ,
	APP_GITHUB_URL,
	APP_RELEASES_URL,
} from "../shared/app-meta";
import {
	AUTO_UPDATE_CHECK_PREF,
	UPDATE_CHECK_INTERVAL_PREF,
	isAutoUpdateCheckEnabled,
	parseUpdateCheckIntervalHours,
	type AppUpdateProgress,
	type AppUpdateState,
} from "../shared/update";
import { isOfflineMode } from "../shared/offline";
import { onPrefsChanged, prefsPath, readPrefs } from "./prefs-store";
import {
	checkForAppUpdate,
	launchAppUpdate,
	startAppUpdateDownload,
	type AppUpdateDownload,
} from "./app-update";
import { registerUpdateToastIpc, syncUpdateToast } from "./update-toast";

/** 启动后延迟检查更新的时长（毫秒），避开首屏加载。 */
const AUTO_CHECK_DELAY_MS = 8000;

let state: AppUpdateState = {
	status: "idle",
	info: null,
	progress: null,
	error: null,
};
let downloadedPath: string | null = null;
let download: AppUpdateDownload | null = null;
let cancelRequested = false;
let autoCheckTimer: NodeJS.Timeout | null = null;

const HOUR_MS = 60 * 60 * 1000;

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function publish(patch: Partial<AppUpdateState>): void {
	state = { ...state, ...patch };
	for (const win of BrowserWindow.getAllWindows()) {
		win.webContents.send(IpcChannels.update.state, state);
	}
	syncUpdateToast(state);
}

/** 检查新版本。 */
async function runCheck(): Promise<AppUpdateState> {
	if (isOfflineMode()) {
		publish({ status: "idle", info: null, progress: null, error: null });
		return state;
	}
	publish({ status: "checking", error: null });
	try {
		const info = await checkForAppUpdate(app.getVersion());
		publish({ status: info ? "available" : "idle", info, progress: null });
	} catch (err) {
		publish({ status: "idle", info: null, progress: null, error: errorMessage(err) });
	}
	return state;
}

/** 读取自动检查的间隔；关闭或离线时返回 null。 */
function autoCheckIntervalMs(): number | null {
	if (isOfflineMode()) return null;
	const prefs = readPrefs(prefsPath());
	if (!isAutoUpdateCheckEnabled(prefs)) return null;
	return parseUpdateCheckIntervalHours(prefs[UPDATE_CHECK_INTERVAL_PREF]) * HOUR_MS;
}

function clearAutoCheckTimer(): void {
	if (autoCheckTimer === null) return;
	clearTimeout(autoCheckTimer);
	autoCheckTimer = null;
}

function scheduleAutoCheck(delayMs: number): void {
	clearAutoCheckTimer();
	autoCheckTimer = setTimeout(() => {
		autoCheckTimer = null;
		void runScheduledCheck();
	}, delayMs);
	autoCheckTimer.unref();
}

/** 定时检查：已有更新或正在检查、下载时不再打扰当前流程。 */
async function runScheduledCheck(): Promise<void> {
	const busy =
		state.status === "checking" ||
		state.status === "available" ||
		state.status === "downloading" ||
		state.status === "ready";
	if (!busy) await runCheck();
	const interval = autoCheckIntervalMs();
	if (interval !== null && autoCheckTimer === null) scheduleAutoCheck(interval);
}

/** 按当前偏好启动自动检查；启动时延迟检查，避开首屏加载。 */
function startAutoCheck(delayMs = AUTO_CHECK_DELAY_MS): void {
	if (autoCheckIntervalMs() === null) {
		clearAutoCheckTimer();
		return;
	}
	scheduleAutoCheck(delayMs);
}

/** 自动检查相关偏好变化后立即生效：关闭时停表，开启或改间隔时重新计时。 */
function applyAutoCheckPrefs(keys: string[]): void {
	if (!keys.includes(AUTO_UPDATE_CHECK_PREF) && !keys.includes(UPDATE_CHECK_INTERVAL_PREF)) {
		return;
	}
	const interval = autoCheckIntervalMs();
	if (interval === null) {
		clearAutoCheckTimer();
		return;
	}
	scheduleAutoCheck(keys.includes(AUTO_UPDATE_CHECK_PREF) ? AUTO_CHECK_DELAY_MS : interval);
}

/** 下载新版本，过程与结果通过状态广播给渲染层。 */
async function runDownload(): Promise<void> {
	const info = state.info;
	if (!info) return;
	if (state.status === "downloading" || state.status === "ready") return;
	cancelRequested = false;
	downloadedPath = null;
	publish({ status: "downloading", progress: null, error: null });

	const onProgress = (progress: AppUpdateProgress): void => {
		if (progress.phase === "done") {
			publish({ status: "ready", progress });
			return;
		}
		publish({ progress });
	};

	download = startAppUpdateDownload(info, onProgress);
	try {
		downloadedPath = await download.promise;
	} catch (err) {
		if (cancelRequested) {
			publish({ status: "available", progress: null, error: null });
			return;
		}
		publish({ status: "error", progress: null, error: errorMessage(err) });
	} finally {
		download = null;
	}
}

/**
 * 真实更新测试：忽略版本比较，始终取最新发布版的安装包并下载。
 * 用于验证「检测 → 下载 → 安装」整条链路。
 */
async function runForceUpdate(): Promise<void> {
	if (state.status === "downloading" || state.status === "ready") return;
	publish({ status: "checking", info: null, progress: null, error: null });
	try {
		const info = await checkForAppUpdate(app.getVersion(), true);
		if (!info) {
			publish({ status: "error", error: "没有找到适用于当前系统的安装包" });
			return;
		}
		publish({ status: "available", info, progress: null, error: null });
	} catch (err) {
		publish({ status: "error", error: errorMessage(err) });
		return;
	}
	await runDownload();
}

/** 启动安装程序并退出应用。 */
async function runInstall(): Promise<void> {
	if (!downloadedPath) return;
	try {
		await launchAppUpdate(downloadedPath);
	} catch (err) {
		publish({ status: "error", error: errorMessage(err) });
		return;
	}
	app.quit();
}

export function registerUpdateIpc(): void {
	ipcMain.handle(IpcChannels.update.getAppInfo, () => ({
		version: app.getVersion(),
		githubUrl: APP_GITHUB_URL,
		releasesUrl: APP_RELEASES_URL,
		author: APP_AUTHOR,
		qq: APP_AUTHOR_QQ,
		email: APP_AUTHOR_EMAIL,
	}));

	ipcMain.handle(IpcChannels.update.openReleases, async () => {
		await shell.openExternal(APP_RELEASES_URL);
	});

	ipcMain.handle(IpcChannels.update.openAuthorEmail, async () => {
		await shell.openExternal(`mailto:${APP_AUTHOR_EMAIL}`);
	});

	ipcMain.handle(IpcChannels.update.getState, () => state);

	ipcMain.handle(IpcChannels.update.check, () => runCheck());

	ipcMain.handle(IpcChannels.update.download, () => {
		// 下载可能持续数分钟，握手后立即返回，进度通过状态广播。
		void runDownload();
	});

	ipcMain.handle(IpcChannels.update.forceUpdate, () => {
		void runForceUpdate();
	});

	ipcMain.handle(IpcChannels.update.cancel, () => {
		cancelRequested = true;
		download?.cancel();
	});

	ipcMain.handle(IpcChannels.update.install, () => runInstall());

	registerUpdateToastIpc();
	onPrefsChanged(applyAutoCheckPrefs);
	startAutoCheck();
}

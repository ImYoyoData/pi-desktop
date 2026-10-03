import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app, BrowserWindow, ipcMain, session } from "electron";
import { IpcChannels } from "../shared/protocol";
import {
	DEFAULT_PROXY_SETTINGS,
	normalizeProxyUrl,
	PROXY_ENV_KEYS,
	proxyEnvFromPacResult,
	proxyEnvFromUrl,
	PROXY_MODES,
	resolveNodeProxyMode,
	type NodeProxyMode,
	type ProxySettings,
} from "../shared/proxy";

const SYSTEM_PROXY_PROBE_URL = "https://api.openai.com";

let currentSettings: ProxySettings = { ...DEFAULT_PROXY_SETTINGS };
let systemProxyEnv: Record<string, string> = {};

function settingsPath(): string {
	return join(app.getPath("userData"), "proxy.json");
}

function readSettingsFromDisk(): ProxySettings {
	try {
		const raw = JSON.parse(
			readFileSync(settingsPath(), "utf8"),
		) as Partial<ProxySettings>;
		const mode = PROXY_MODES.includes(raw.mode as ProxySettings["mode"])
			? (raw.mode as ProxySettings["mode"])
			: DEFAULT_PROXY_SETTINGS.mode;
		return {
			mode,
			url: typeof raw.url === "string" ? raw.url : "",
		};
	} catch {
		return { ...DEFAULT_PROXY_SETTINGS };
	}
}

function writeSettingsToDisk(settings: ProxySettings): void {
	const file = settingsPath();
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
}

async function applyProxySettings(settings: ProxySettings): Promise<void> {
	const ses = session.defaultSession;
	if (settings.mode === "custom") {
		const url = normalizeProxyUrl(settings.url);
		if (url) {
			await ses.setProxy({ proxyRules: url });
			return;
		}
		await ses.setProxy({ mode: "direct" });
		return;
	}
	if (settings.mode === "system") {
		await ses.setProxy({ mode: "system" });
		return;
	}
	await ses.setProxy({ mode: "direct" });
}

async function refreshSystemProxyEnv(): Promise<void> {
	if (currentSettings.mode !== "system") {
		systemProxyEnv = {};
		return;
	}
	try {
		const result = await session.defaultSession.resolveProxy(
			SYSTEM_PROXY_PROBE_URL,
		);
		systemProxyEnv = proxyEnvFromPacResult(result);
	} catch {
		systemProxyEnv = {};
	}
}

function broadcastChanged(settings: ProxySettings): void {
	for (const win of BrowserWindow.getAllWindows()) {
		win.webContents.send(IpcChannels.proxy.changed, settings);
	}
}

/** 上次生效的代理 env 快照；NODE_USE_ENV_PROXY 只在进程启动时生效，OAuth 等
 *  SDK 裸 fetch 依赖它，因此持久化并在主进程入口最早处恢复。 */
function proxyEnvSnapshotPath(): string {
	return join(app.getPath("userData"), "proxy-env.json");
}

function persistProxyEnvSnapshot(): void {
	try {
		const env = withProxyEnv({});
		const snapshot: Record<string, string> = {};
		for (const key of [...PROXY_ENV_KEYS, "NODE_USE_ENV_PROXY"]) {
			const value = env[key];
			if (typeof value === "string" && value) snapshot[key] = value;
		}
		const file = proxyEnvSnapshotPath();
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
	} catch (err) {
		console.warn("[proxy] failed to persist proxy env snapshot", err);
	}
}

/** 主进程入口在 userData 路径定型后立即调用，早于任何 fetch。 */
export function restoreStartupProxyEnv(): void {
	for (const key of PROXY_ENV_KEYS) delete process.env[key];
	delete process.env.NODE_USE_ENV_PROXY;
	try {
		const snapshot = JSON.parse(
			readFileSync(proxyEnvSnapshotPath(), "utf8"),
		) as Record<string, unknown>;
		for (const [key, value] of Object.entries(snapshot)) {
			if (typeof value === "string" && value) process.env[key] = value;
		}
	} catch {
		// 无快照（首次启动 / 关闭代理）——保持无代理
	}
}

export function getProxySettings(): ProxySettings {
	return { ...currentSettings };
}

/** 主进程 Node fetch（undici）当前应使用的代理形态。 */
export function getNodeProxyMode(): NodeProxyMode {
	return resolveNodeProxyMode(currentSettings, systemProxyEnv);
}

/** 应用设置优先：先清除继承的代理变量，再按模式注入。
 *  NODE_USE_ENV_PROXY 让 Node 内置 fetch（undici）遵循这些变量。 */
export function withProxyEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const next = { ...env };
	for (const key of PROXY_ENV_KEYS) delete next[key];
	delete next.NODE_USE_ENV_PROXY;
	let proxyEnv: Record<string, string> = {};
	if (currentSettings.mode === "custom") {
		proxyEnv = proxyEnvFromUrl(currentSettings.url);
	} else if (currentSettings.mode === "system") {
		proxyEnv = systemProxyEnv;
	}
	if (Object.keys(proxyEnv).length > 0) {
		Object.assign(next, proxyEnv);
		next.NODE_USE_ENV_PROXY = "1";
	}
	return next;
}

/** 同步到主进程 env：主进程及其 spawn 的子进程（npm / git / pi CLI / SDK）都继承它。
 *  主进程自身的 fetch 不受影响，仍须走 netFetch。 */
function applyHostProxyEnv(): void {
	for (const key of PROXY_ENV_KEYS) delete process.env[key];
	delete process.env.NODE_USE_ENV_PROXY;
	Object.assign(process.env, withProxyEnv({}));
}

/** Load persisted settings and apply them; call once after app ready. */
export async function initProxy(): Promise<void> {
	currentSettings = readSettingsFromDisk();
	// 首次启动（用户从未设置过代理）：探测系统代理并自动采用，让 OAuth 等
	// 主进程裸 fetch 与浏览器同路；之后用户在设置里改模式会落盘，不再触发。
	if (!existsSync(settingsPath())) {
		try {
			const result = await session.defaultSession.resolveProxy(
				SYSTEM_PROXY_PROBE_URL,
			);
			const detected = proxyEnvFromPacResult(result);
			if (Object.keys(detected).length > 0) {
				currentSettings = { mode: "system", url: "" };
				writeSettingsToDisk(currentSettings);
			}
		} catch {
			// 探测失败保持默认 off
		}
	}
	try {
		await applyProxySettings(currentSettings);
		await refreshSystemProxyEnv();
	} catch (err) {
		console.warn("[proxy] failed to apply settings on startup", err);
	} finally {
		applyHostProxyEnv();
		persistProxyEnvSnapshot();
	}
}

/** 启动依赖环境的进程前重新探测系统代理。 */
export async function refreshSystemProxy(): Promise<void> {
	if (currentSettings.mode !== "system") return;
	await refreshSystemProxyEnv();
}

export function registerProxyIpc(opts?: {
	onChanged?: (settings: ProxySettings) => void;
}): void {
	ipcMain.handle(IpcChannels.proxy.get, () => getProxySettings());

	ipcMain.handle(
		IpcChannels.proxy.set,
		async (_event, payload: Partial<ProxySettings> | null | undefined) => {
			const mode = PROXY_MODES.includes(payload?.mode as ProxySettings["mode"])
				? (payload?.mode as ProxySettings["mode"])
				: DEFAULT_PROXY_SETTINGS.mode;
			const url = typeof payload?.url === "string" ? payload.url.trim() : "";
			if (mode === "custom" && !normalizeProxyUrl(url)) {
				throw new Error("Invalid proxy URL");
			}
			const next: ProxySettings = {
				mode,
				url: mode === "custom" ? (normalizeProxyUrl(url) ?? "") : url,
			};
			currentSettings = next;
			try {
				writeSettingsToDisk(next);
			} catch (err) {
				console.warn("[proxy] failed to persist settings", err);
			}
			await applyProxySettings(next);
			await refreshSystemProxyEnv();
			applyHostProxyEnv();
			persistProxyEnvSnapshot();
			broadcastChanged(next);
			opts?.onChanged?.(next);
			return getProxySettings();
		},
	);
}

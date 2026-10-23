/**
 * 桌面端偏好读写。
 *
 * 之前全部落在 localStorage：它跟着 Electron userData 与页面 origin 走，
 * 安装包（file://）与 npm run dev（http://localhost:5173）各有一份，
 * 同一台机器两种启动方式配置互不相干，各类界面开关每每"被重置"。
 *
 * 现在 ~/.pi/agent/desktop-prefs.json 是唯一权威存储，两种启动方式共用；
 * localStorage 降级为镜像，只用于把各来源的历史值并进来。
 * 无 IPC 环境（单测）直接透传 localStorage。
 */

type PrefsMap = Record<string, string>;

/** 只搬运本应用自己的键，避免把 origin 下的无关数据卷进来。 */
const MIGRATE_PREFIXES = [
	"pi-desktop:",
	"session-pins:",
	"layout:",
	"right-dock",
	"keybindings",
	"notify",
];

const FLUSH_DELAY_MS = 150;

function sharedAvailable(): boolean {
	return typeof window !== "undefined" && !!window.api?.prefs;
}

function isMigratable(key: string): boolean {
	return MIGRATE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

const cache: PrefsMap = sharedAvailable() ? window.api.prefs.readSync() ?? {} : {};

const pendingSet = new Set<string>();
const pendingRemove = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function takePatch(): { patch: PrefsMap; removed: string[] } {
	const patch: PrefsMap = {};
	for (const key of pendingSet) patch[key] = cache[key];
	const removed = [...pendingRemove];
	pendingSet.clear();
	pendingRemove.clear();
	return { patch, removed };
}

async function flushAsync(): Promise<void> {
	const { patch, removed } = takePatch();
	if (Object.keys(patch).length) await window.api.prefs.set(patch);
	if (removed.length) await window.api.prefs.remove(removed);
}

/** 退出前同步补齐未落盘的改动，避免最后一次设置丢失。 */
function flushSync(): void {
	if (!sharedAvailable() || (pendingSet.size === 0 && pendingRemove.size === 0)) return;
	const { patch, removed } = takePatch();
	if (Object.keys(patch).length) window.api.prefs.setSync(patch);
	if (removed.length) window.api.prefs.removeSync(removed);
}

/** 连续拖拽等高频写入合并成一次 IPC，避免逐次同步往返。 */
function scheduleFlush(): void {
	if (!sharedAvailable() || flushTimer !== null) return;
	flushTimer = setTimeout(() => {
		flushTimer = null;
		void flushAsync();
	}, FLUSH_DELAY_MS);
}

function writeLocal(key: string, value: string | null): void {
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		// ignore
	}
}

function track(key: string): void {
	pendingSet.add(key);
	pendingRemove.delete(key);
	scheduleFlush();
}

function untrack(key: string): void {
	pendingRemove.add(key);
	pendingSet.delete(key);
	scheduleFlush();
}

/**
 * 把各来源 localStorage 里文件没有的键并进来。
 * dev 与安装包各有一份历史 localStorage，先启动的那份先到，
 * 另一份只补差集；文件已有的键不再被 localStorage 覆盖，
 * 用户在新存储里删掉的键也不会被旧镜像复活（写删时同步清镜像）。
 */
function absorbLegacy(): void {
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key || !isMigratable(key)) continue;
			const value = localStorage.getItem(key);
			if (value === null) continue;
			if (key in cache) {
				writeLocal(key, null);
				continue;
			}
			cache[key] = value;
			track(key);
		}
	} catch {
		// 无 localStorage
	}
}

if (sharedAvailable()) {
	absorbLegacy();
	if (typeof window.addEventListener === "function") {
		window.addEventListener("beforeunload", flushSync);
	}
}

export function getItem(key: string): string | null {
	if (!sharedAvailable()) return localStorage.getItem(key);
	const value = cache[key];
	return value === undefined ? null : value;
}

export function setItem(key: string, value: string): void {
	if (!sharedAvailable()) {
		localStorage.setItem(key, value);
		return;
	}
	cache[key] = value;
	writeLocal(key, value);
	track(key);
}

export function removeItem(key: string): void {
	if (!sharedAvailable()) {
		localStorage.removeItem(key);
		return;
	}
	delete cache[key];
	writeLocal(key, null);
	untrack(key);
}

export function keys(): string[] {
	if (!sharedAvailable()) return Object.keys(localStorage);
	return Object.keys(cache);
}
/**
 * 桌面端偏好存储：~/.pi/agent/desktop-prefs.json。
 *
 * 之前这些配置全放在渲染进程 localStorage 里，而 localStorage 绑定在
 * Electron 的 userData + 页面 origin 上：安装包是 <userData>/Local Storage +
 * file://，npm run dev 换成 userData/Local Storage + http://localhost:5173，
 * 两边互相看不见，于是主题、壁纸、会话排序、界面开关各走各的。
 * 这里改为落在 agent 目录，dev 与安装包共用同一份文件。
 */

import fs from "node:fs";
import path from "node:path";
import { agentDir } from "./agent-dir";
import { DESKTOP_PREFS_FILENAME } from "../shared/browser-settings";

export function prefsPath(agentDirOverride?: string): string {
	return path.join(path.resolve(agentDirOverride ?? agentDir()), DESKTOP_PREFS_FILENAME);
}

function isStringMap(value: unknown): value is Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	return Object.values(value).every((item) => typeof item === "string");
}

export function readPrefs(filePath: string): Record<string, string> {
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
		if (isStringMap(parsed)) return parsed;
	} catch {
		// 文件缺失或损坏 —— 视为空偏好
	}
	return {};
}

function writeJsonAtomic(filePath: string, data: Record<string, string>): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	fs.renameSync(tmp, filePath);
}

/** v1：串行读改写，并发写者按入队顺序落盘。 */
let writeQueue: Promise<void> = Promise.resolve();

/** 队列内合并 patch，保留其它键。 */
export function updatePrefs(
	patch: Record<string, string>,
	agentDirOverride?: string,
): Promise<Record<string, string>> {
	const filePath = prefsPath(agentDirOverride);
	const task = (): Record<string, string> => {
		const merged = { ...readPrefs(filePath), ...patch };
		writeJsonAtomic(filePath, merged);
		return merged;
	};
	const next = writeQueue.then(task, task);
	writeQueue = next.then(
		() => undefined,
		() => undefined,
	);
	return next;
}

/** 删除键后回写，返回剩余偏好。 */
export function removePrefs(
	keys: string[],
	agentDirOverride?: string,
): Promise<Record<string, string>> {
	const filePath = prefsPath(agentDirOverride);
	const task = (): Record<string, string> => {
		const next = readPrefs(filePath);
		for (const key of keys) delete next[key];
		writeJsonAtomic(filePath, next);
		return next;
	};
	const next = writeQueue.then(task, task);
	writeQueue = next.then(
		() => undefined,
		() => undefined,
	);
	return next;
}

/** 退出等来不及等异步队列的场合：直接读改写落盘。 */
export function updatePrefsSync(
	patch: Record<string, string>,
	agentDirOverride?: string,
): Record<string, string> {
	const filePath = prefsPath(agentDirOverride);
	const merged = { ...readPrefs(filePath), ...patch };
	writeJsonAtomic(filePath, merged);
	return merged;
}
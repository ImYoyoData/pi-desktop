/**
 * 桌面端用户级状态：dev 与安装包共用 agent 目录下的一份文件。
 *
 * dev 使用独立 userData（pi-desktop-dev）隔离 Chromium 缓存，但设置与工作区
 * 状态若跟着 userData 走就会两边各存一份。这里把状态文件统一放到 agent 目录，
 * 并在启动时把旧 userData 里的文件复制过来（目标已存在则保留）。
 */

import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { agentDir } from "./agent-dir";

/** 必须共用的用户级状态：模型选择、代理、Pi CLI 偏好、工作区与引擎选择。 */
export const SHARED_DESKTOP_FILES = [
	"models-selection.json",
	"proxy.json",
	"proxy-env.json",
	"pi-cli-prefs.json",
	"workspace-state.json",
] as const;

export function desktopDataPath(name: string): string {
	return path.join(agentDir(), name);
}

/** 旧 userData 目录：当前模式 + 两种默认安装名，两侧互相补差集。 */
function legacyUserDataDirs(): string[] {
	const appData = app.getPath("appData");
	const dirs = [
		app.getPath("userData"),
		path.join(appData, "pi-desktop"),
		path.join(appData, "Pi Desktop"),
		path.join(appData, "pi-desktop-dev"),
	];
	return [...new Set(dirs.map((dir) => path.resolve(dir)))];
}

/** 目标已存在时保留；否则按来源顺序复制第一份存在的文件，返回是否复制。 */
export function migrateFile(
	sourceDirs: readonly string[],
	target: string,
): boolean {
	if (fs.existsSync(target)) return false;
	for (const dir of sourceDirs) {
		const source = path.join(dir, path.basename(target));
		if (!fs.existsSync(source)) continue;
		try {
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.copyFileSync(source, target);
			return true;
		} catch (err) {
			console.warn("[desktop-data] migrate failed", source, err);
			return false;
		}
	}
	return false;
}

export function migrateDesktopDataFiles(): void {
	const sources = legacyUserDataDirs();
	for (const name of SHARED_DESKTOP_FILES) {
		migrateFile(sources, desktopDataPath(name));
	}
}

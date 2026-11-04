import { app, ipcMain } from "electron";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { IpcChannels } from "../shared/protocol";
import type { OmpCliStatus } from "../shared/omp-cli";
import { cleanProbeEnv, probeCliVersion, resolveCommand } from "./pi-cli-host";

/**
 * 应用内置 omp SDK 的版本：dev 读项目 node_modules，打包读 asar 或
 * extraResources 里的构建期版本文件（主进程不 import omp SDK）。
 */
export function getOmpSdkVersion(): string | null {
	const candidates = [
		join(
			app.getAppPath(),
			"node_modules",
			"@oh-my-pi",
			"pi-coding-agent",
			"package.json",
		),
		join(process.resourcesPath ?? "", "omp", "omp-sdk-version.json"),
	];
	for (const file of candidates) {
		try {
			const raw = JSON.parse(readFileSync(file, "utf8")) as { version?: string };
			if (raw.version) return raw.version;
		} catch {
			// 换下一个候选路径
		}
	}
	return null;
}

/** 系统 PATH 里 omp CLI 的安装状态与版本（仅展示，不提供安装入口）。 */
export async function getOmpCliStatus(): Promise<OmpCliStatus> {
	const env = cleanProbeEnv();
	const resolved = await resolveCommand("omp", env);
	const ompPath =
		resolved ??
		(process.platform === "win32"
			? null
			: join(homedir(), ".local", "bin", "omp"));
	if (!ompPath || !existsSync(ompPath)) {
		return { installed: false, version: null };
	}
	return { installed: true, version: await probeCliVersion(ompPath, env) };
}

export function registerOmpVersionIpc(): void {
	ipcMain.handle(IpcChannels.ompVersions.sdkVersion, () => getOmpSdkVersion());
	ipcMain.handle(IpcChannels.ompVersions.cliStatus, async () =>
		getOmpCliStatus(),
	);
}

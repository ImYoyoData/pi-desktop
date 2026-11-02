import { homedir } from "node:os";
import path from "node:path";

/**
 * omp 的配置根：`<config>/agent`，默认 `~/.omp/agent`。
 *
 * omp SDK 的 getAgentDir() 还会处理 profile 与 Linux XDG 迁移；桌面端只用
 * 这里的默认布局，遇到非默认目录时由用户改 PI_CONFIG_DIR。
 * shortcut: 不认 omp profile/XDG，非默认安装请设置 PI_CONFIG_DIR。
 */
export function ompAgentDir(): string {
	const envDir = process.env.OMP_AGENT_DIR;
	if (envDir && envDir.trim()) {
		return path.normalize(path.resolve(expandHome(envDir.trim())));
	}
	const configDir = process.env.PI_CONFIG_DIR?.trim() || ".omp";
	return path.join(homeDir(), configDir, "agent");
}

/** omp 的会话根目录，与 pi 同样的 `sessions/--cwd--` 布局。 */
export function ompSessionsDir(): string {
	return path.join(ompAgentDir(), "sessions");
}

function homeDir(): string {
	return process.env.HOME || homedir();
}

function expandHome(raw: string): string {
	return raw.startsWith("~") ? path.join(homeDir(), raw.slice(1)) : raw;
}

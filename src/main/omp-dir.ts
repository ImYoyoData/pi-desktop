import { homedir } from "node:os";
import path from "node:path";

/**
 * omp 的配置根：`<config>/agent`，默认 `~/.omp/agent`。
 *
 * 不读 `PI_CODING_AGENT_DIR`：那是 pi 的目录变量，桌面端两侧共用它就会把
 * 两套会话与配置堆进同一个 agent 目录。omp 只认自己的两个变量。
 * 算出的目录会随 init 消息交给 worker，由 worker 显式使用。
 * shortcut: 不认 omp profile 与 Linux XDG 迁移，那两种安装需手动设目录。
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

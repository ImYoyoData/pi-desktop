import { homedir } from "node:os";
import path from "node:path";

/**
 * omp 的配置根：`<config>/agent`，默认 `~/.omp/agent`。
 *
 * worker 里的 omp SDK 按 `PI_CODING_AGENT_DIR` → `<PI_CONFIG_DIR|.omp>/agent`
 * 的顺序解析目录，桌面端必须算出同一个路径，否则会去读另一套会话与配置。
 * shortcut: 不认 omp profile 与 Linux XDG 迁移，那两种安装需手动设目录。
 */
export function ompAgentDir(): string {
	// 测试与隔离运行用的显式覆盖，优先级最高。
	const testDir = process.env.OMP_AGENT_DIR;
	if (testDir && testDir.trim()) {
		return path.normalize(path.resolve(expandHome(testDir.trim())));
	}
	const agentEnv = process.env.PI_CODING_AGENT_DIR;
	if (agentEnv && agentEnv.trim()) {
		return path.normalize(path.resolve(expandHome(agentEnv.trim())));
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

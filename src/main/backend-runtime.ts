import type { AgentBackend } from "../shared/agent-backend";
import type {
	WorkerInbound,
	WorkerOutbound,
} from "../shared/agent-worker-messages";

/** 主进程与某个后端 worker 进程的通用句柄。 */
export type WorkerHandle = {
	send: (msg: WorkerInbound) => Promise<WorkerOutbound | null>;
	kill: () => void;
	onMessage: (cb: (msg: WorkerOutbound) => void) => () => void;
};

export type SpawnWorker = (
	cwd: string,
	filePath?: string,
) => Promise<{
	worker: WorkerHandle;
	id: string;
	filePath: string;
	cwd: string;
}>;

/**
 * 一个智能体后端在桌面侧的全部差异：配置目录、会话落盘、进程启动。
 *
 * 会话记录记住自己属于哪个后端，broker 按它取运行时，不做全局开关。
 */
export type BackendRuntime = {
	backend: AgentBackend;
	agentDir: string;
	sessionsRoot: string;
	spawnWorker: SpawnWorker;
	/** 新建会话并落盘（不启动进程）。 */
	allocate: (cwd: string) => Promise<{
		id: string;
		cwd: string;
		filePath: string;
	}>;
};

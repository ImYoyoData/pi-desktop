import path from "node:path";
import type { AgentBackend } from "../shared/agent-backend";
import type { BackendRuntime } from "./backend-runtime";
import { agentDir } from "./agent-dir";
import { createUtilityProcessSpawnWorker } from "./agent-worker-host";
import { createOmpSpawnWorker } from "./omp-worker-host";
import { ompAgentDir, ompSessionsDir } from "./omp-dir";
import { allocateSessionOnDisk } from "./session-allocate";
import { allocateOmpSessionOnDisk } from "./omp-session-allocate";

/** 两套后端的运行时差异全在这里，其它主进程代码只认 BackendRuntime。 */
export function createAgentBackends(): Record<AgentBackend, BackendRuntime> {
	const piDir = agentDir();
	return {
		pi: {
			backend: "pi",
			agentDir: piDir,
			sessionsRoot: path.join(piDir, "sessions"),
			spawnWorker: createUtilityProcessSpawnWorker(),
			allocate: allocateSessionOnDisk,
		},
		omp: {
			backend: "omp",
			agentDir: ompAgentDir(),
			sessionsRoot: ompSessionsDir(),
			spawnWorker: createOmpSpawnWorker(),
			allocate: allocateOmpSessionOnDisk,
		},
	};
}

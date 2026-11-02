import { spawn } from "node:child_process";
import { app } from "electron";
import path from "node:path";
import type {
	WorkerInbound,
	WorkerOutbound,
} from "../shared/agent-worker-messages";
import type {
	OmpWorkerInbound,
	OmpWorkerOutbound,
} from "../shared/omp-worker-messages";
import type { SpawnWorker, WorkerHandle } from "./backend-runtime";
import { ompAgentDir } from "./omp-dir";
import { resolveOmpRuntime } from "./omp-runtime-path";
import { refreshSystemProxy, withAgentProxyEnv } from "./proxy-host";

function searchRoots(): string[] {
	return [
		app.getAppPath(),
		path.join(app.getAppPath(), ".."),
		process.cwd(),
		path.resolve(__dirname, "../.."),
		path.resolve(__dirname, "../../.."),
	];
}

/** omp 私有协议 → broker 的通用 worker 消息。 */
function toBrokerMessage(msg: OmpWorkerOutbound): WorkerOutbound {
	switch (msg.kind) {
		case "ready":
			return {
				kind: "ready",
				id: msg.id,
				filePath: msg.filePath,
				cwd: msg.cwd,
			};
		case "result":
			return {
				kind: "result",
				id: msg.id,
				data: msg.data,
				error: msg.error,
			};
		case "event":
			return { kind: "event", event: msg.event };
		case "pong":
			return { kind: "pong" };
		case "fatal":
			return { kind: "fatal", error: msg.error };
		case "rpc_request":
			return {
				kind: "rpc_request",
				id: msg.id,
				method: msg.method,
				params: msg.params,
			};
	}
}

/** broker 的通用消息 → omp 私有协议；omp 不认识的 message 直接丢弃。 */
function toOmpInbound(msg: WorkerInbound): OmpWorkerInbound | null {
	switch (msg.kind) {
		case "init":
			return {
				kind: "init",
				cwd: msg.cwd,
				filePath: msg.filePath,
				agentDir: ompAgentDir(),
			};
		case "command":
			return { kind: "command", id: msg.id, command: msg.command };
		case "reload_models":
			return { kind: "reload_models" };
		case "shutdown":
			return { kind: "shutdown" };
		case "ping":
			return { kind: "ping" };
		case "rpc_response":
			return {
				kind: "rpc_response",
				id: msg.id,
				result: msg.result,
				error: msg.error,
			};
		default:
			return null;
	}
}

export function createOmpSpawnWorker(): SpawnWorker {
	return async (cwd, filePath) => {
		await refreshSystemProxy();
		const runtime = resolveOmpRuntime(searchRoots());
		const child = spawn(runtime.command, runtime.args, {
			cwd,
			env: withAgentProxyEnv({ ...process.env }),
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});

		const listeners = new Set<(msg: WorkerOutbound) => void>();
		let expectExit = false;

		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			process.stderr.write(`[omp-worker] ${chunk}`);
		});
		child.on("error", (err) => {
			for (const cb of listeners) cb({ kind: "fatal", error: err.message });
		});
		child.on("exit", (code) => {
			if (expectExit || code === 0) return;
			for (const cb of listeners) {
				cb({ kind: "fatal", error: `omp worker exited (${code ?? "null"})` });
			}
		});

		let buffered = "";
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			buffered += chunk;
			let newline = buffered.indexOf("\n");
			while (newline >= 0) {
				const line = buffered.slice(0, newline).trim();
				buffered = buffered.slice(newline + 1);
				if (line) {
					try {
						const msg = toBrokerMessage(JSON.parse(line) as OmpWorkerOutbound);
						for (const cb of listeners) cb(msg);
					} catch {
						process.stderr.write(`[omp-worker] bad frame: ${line.slice(0, 200)}\n`);
					}
				}
				newline = buffered.indexOf("\n");
			}
		});

		const handle: WorkerHandle = {
			send: (msg: WorkerInbound) => {
				const outbound = toOmpInbound(msg);
				if (outbound) child.stdin?.write(`${JSON.stringify(outbound)}\n`);
				return Promise.resolve(null);
			},
			kill: () => {
				expectExit = true;
				child.kill();
			},
			onMessage: (cb) => {
				listeners.add(cb);
				return () => listeners.delete(cb);
			},
		};

		const ready = new Promise<{ id: string; filePath: string; cwd: string }>(
			(resolve, reject) => {
				const timer = setTimeout(() => {
					off();
					handle.kill();
					reject(new Error("omp worker ready timed out after 45000ms"));
				}, 45_000);
				const off = handle.onMessage((msg) => {
					if (msg.kind === "ready") {
						clearTimeout(timer);
						off();
						resolve({ id: msg.id, filePath: msg.filePath, cwd: msg.cwd });
						return;
					}
					if (msg.kind === "fatal") {
						clearTimeout(timer);
						off();
						reject(new Error(msg.error));
					}
				});
			},
		);

		child.stdin?.write(
			`${JSON.stringify({ kind: "init", cwd, filePath, agentDir: ompAgentDir() } satisfies OmpWorkerInbound)}\n`,
		);

		return { worker: handle, ...(await ready) };
	};
}

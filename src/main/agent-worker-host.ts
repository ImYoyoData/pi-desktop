import { utilityProcess } from "electron";
import path from "node:path";
import type { WorkerInbound, WorkerOutbound } from "../shared/agent-worker-messages";
import type { SpawnWorker, WorkerHandle } from "./session-broker";

function workerScriptPath(): string {
  return path.join(__dirname, "agent-worker/index.js");
}

export function createUtilityProcessSpawnWorker(): SpawnWorker {
  return async (sessionId, cwd) => {
    const child = utilityProcess.fork(workerScriptPath(), [], {
      cwd,
      serviceName: `pi-agent-${sessionId.slice(0, 8)}`,
      stdio: "pipe",
    });

    const messageListeners = new Set<(msg: WorkerOutbound) => void>();

    child.on("message", (raw: WorkerOutbound) => {
      for (const cb of messageListeners) {
        cb(raw);
      }
    });

    child.on("exit", (code) => {
      for (const cb of messageListeners) {
        cb({ kind: "fatal", error: `worker exited (${code ?? "null"})` });
      }
    });

    const handle: WorkerHandle = {
      send: (msg: WorkerInbound) => {
        child.postMessage(msg);
        return Promise.resolve(null);
      },
      kill: () => {
        child.kill();
      },
      onMessage: (cb) => {
        messageListeners.add(cb);
        return () => messageListeners.delete(cb);
      },
    };

    return handle;
  };
}

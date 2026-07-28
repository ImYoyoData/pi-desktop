import { utilityProcess } from "electron";
import path from "node:path";
import type { WorkerInbound, WorkerOutbound } from "../shared/agent-worker-messages";
import type { SpawnWorker, WorkerHandle } from "./session-broker";
import { getDesktopSecuritySettings } from "./desktop-security-host";
import { augmentPathForPiCli } from "./pi-path-env";
import { resolveTrustState } from "./project-trust";

export { IDLE_WORKER_DESTROY_MS } from "./worker-lifecycle";

function workerScriptPath(): string {
  return path.join(__dirname, "agent-worker/index.js");
}

function waitForReady(
  child: Electron.UtilityProcess,
): Promise<{ id: string; filePath: string; cwd: string }> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: WorkerOutbound) => {
      if (raw.kind === "ready") {
        child.off("message", onMessage);
        resolve({ id: raw.id, filePath: raw.filePath, cwd: raw.cwd });
        return;
      }
      if (raw.kind === "fatal") {
        child.off("message", onMessage);
        reject(new Error(raw.error ?? "worker fatal during init"));
      }
    };
    child.on("message", onMessage);
  });
}

export function createUtilityProcessSpawnWorker(): SpawnWorker {
  return async (cwd, filePath) => {
    const child = utilityProcess.fork(workerScriptPath(), [], {
      cwd,
      serviceName: `pi-agent-${path.basename(cwd).slice(0, 8) || "ws"}`,
      stdio: "pipe",
      env: augmentPathForPiCli({ ...process.env }),
    });

    const messageListeners = new Set<(msg: WorkerOutbound) => void>();
    /** Set when we call kill() — exit is expected (idle destroy / session close). */
    let expectExit = false;

    child.on("message", (raw: WorkerOutbound) => {
      for (const cb of messageListeners) {
        cb(raw);
      }
    });

    child.on("exit", (code) => {
      // Clean shutdown (code 0) or intentional kill must not surface as a chat error.
      if (expectExit || code === 0) {
        return;
      }
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
        expectExit = true;
        child.kill();
      },
      onMessage: (cb) => {
        messageListeners.add(cb);
        return () => messageListeners.delete(cb);
      },
    };

    const readyPromise = waitForReady(child);
    const projectTrusted = resolveTrustState(cwd).projectTrusted;
    const desktopSecurity = await getDesktopSecuritySettings();
    child.postMessage({
      kind: "init",
      cwd,
      filePath,
      projectTrusted,
      desktopSecurity,
    } satisfies WorkerInbound);
    const ready = await readyPromise;

    return { worker: handle, ...ready };
  };
}

import { app, BrowserWindow, utilityProcess } from "electron";
import path from "node:path";
import type {
  WorkerInbound,
  WorkerOutbound,
} from "../shared/agent-worker-messages";
import type { SpawnWorker, WorkerHandle } from "./session-broker";
import { getDesktopSecuritySettings } from "./desktop-security-host";
import { buildAgentWorkerEnv } from "./pi-path-env";
import { withProxyEnv } from "./proxy-host";
import {
  PI_DESKTOP_NODE_PATH_ENV,
  PI_DESKTOP_PI_CLI_PATH_ENV,
} from "../shared/pi-subagent-env";
import { resolveTrustState } from "./project-trust";
import type { WorkerResourceSummary } from "../shared/worker-resources";
import { IpcChannels } from "../shared/protocol";

export { IDLE_WORKER_DESTROY_MS } from "./worker-lifecycle";

function workerScriptPath(): string {
  return path.join(__dirname, "agent-worker/index.js");
}

/** Latest resource summary per session (tools / extensions / skills). */
const sessionResources = new Map<string, WorkerResourceSummary>();

export function getSessionResources(
  sessionId: string,
): WorkerResourceSummary | null {
  return sessionResources.get(sessionId) ?? null;
}

export function clearSessionResources(sessionId: string): void {
  sessionResources.delete(sessionId);
}

function broadcastWorkerResourcesReady(sessionId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed())
      win.webContents.send(IpcChannels.sessions.workerReady, sessionId);
  }
}

function waitForReady(
  child: Electron.UtilityProcess,
  timeoutMs = 45_000,
): Promise<{ id: string; filePath: string; cwd: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.off("message", onMessage);
      try {
        child.kill();
      } catch {
        // ignore
      }
      reject(new Error(`agent worker ready timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const onMessage = (raw: WorkerOutbound) => {
      if (raw.kind === "ready") {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.off("message", onMessage);
        if (raw.resources) {
          sessionResources.set(raw.id, raw.resources);
          broadcastWorkerResourcesReady(raw.id);
          const r = raw.resources;
          console.info(
            `[pi-desktop] worker ready: ${r.extensionCount} extension(s), ${r.skillCount} skill(s), ${r.agentsFileCount ?? 0} agents file(s), ${r.activeTools.length} tool(s)`,
          );
          if (r.agentsFilePaths?.length) {
            console.info(
              `[pi-desktop] agents files: ${r.agentsFilePaths.join(" | ")}`,
            );
          }
          for (const line of r.diagnostics) {
            console.warn(`[pi-desktop] worker resource: ${line}`);
          }
        }
        resolve({ id: raw.id, filePath: raw.filePath, cwd: raw.cwd });
        return;
      }
      if (raw.kind === "fatal") {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.off("message", onMessage);
        reject(new Error(raw.error ?? "worker fatal during init"));
      }
    };
    child.on("message", onMessage);
  });
}

export function createUtilityProcessSpawnWorker(): SpawnWorker {
  return async (cwd, filePath) => {
    const workerEnv = withProxyEnv(
      buildAgentWorkerEnv(
        { ...process.env },
        {
          searchRoots: [
            app.getAppPath(),
            path.join(app.getAppPath(), ".."),
            process.cwd(),
            // electron-vite: out/main → repo root (dev) / resources (packaged)
            path.resolve(__dirname, "../.."),
            path.resolve(__dirname, "../../.."),
          ],
        },
      ),
    );
    const cliForLog = workerEnv[PI_DESKTOP_PI_CLI_PATH_ENV];
    const nodeForLog = workerEnv[PI_DESKTOP_NODE_PATH_ENV];
    if (cliForLog) {
      console.info(
        `[pi-desktop] subagent spawn: node=${nodeForLog ?? "(electron/as-node)"} cli=${cliForLog}`,
      );
    } else {
      console.warn(
        "[pi-desktop] subagent spawn: Pi CLI not resolved; nested agents may fail to launch",
      );
    }

    const child = utilityProcess.fork(workerScriptPath(), [], {
      cwd,
      serviceName: `pi-agent-${path.basename(cwd).slice(0, 8) || "ws"}`,
      stdio: "pipe",
      env: workerEnv,
    });

    // Drain worker stdout/stderr. utilityProcess `stdio: "pipe"` leaves the OS pipe
    // unread when the parent never consumes it; once ~128-256KB of console output
    // accumulates (cold-start resource summaries, extension logs, error stacks over
    // a long session), the next write blocks the worker's event loop — pings stop,
    // prompt() never resolves, and the session looks disconnected with no response.
    // Relay to the main-process console so dev terminals still see worker logs.
    const workerTag = `[worker:${child.pid ?? "?"}]`;
    const relay = (
      stream: NodeJS.ReadableStream | null,
      isErr: boolean,
    ): void => {
      stream?.on("data", (chunk: Buffer) => {
        const text = String(chunk).replace(/\r?\n$/, "");
        if (isErr) console.error(workerTag, text);
        else console.info(workerTag, text);
      });
      // Pipe teardown after worker exit — the exit handler owns the lifecycle.
      stream?.on("error", () => undefined);
    };
    relay(child.stdout, false);
    relay(child.stderr, true);

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

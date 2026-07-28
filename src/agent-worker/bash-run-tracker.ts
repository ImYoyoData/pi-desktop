import { randomUUID } from "node:crypto";
import type { BashOperations } from "@earendil-works/pi-coding-agent";

export type TrackedRunStart = {
  id: string;
  sessionId: string;
  workspaceRoot: string;
  command: string;
  cwd: string;
  startedAt: number;
  pid?: number;
};

export type BashRunTrackerHooks = {
  sessionId: string;
  workspaceRoot: string;
  onStarted: (run: TrackedRunStart) => void;
  onOutput: (runId: string, chunk: string) => void;
  onEnded: (runId: string) => void;
};

export function createTrackedBashOperations(
  base: BashOperations,
  hooks: BashRunTrackerHooks,
): {
  operations: BashOperations;
  terminateRun: (runId: string) => boolean;
  endAllRuns: () => void;
  getActiveRunIds: () => string[];
} {
  const controllers = new Map<string, AbortController>();

  function terminateRun(runId: string): boolean {
    const c = controllers.get(runId);
    if (!c) return false;
    c.abort();
    return true;
  }

  function endAllRuns(): void {
    for (const c of controllers.values()) c.abort();
  }

  function getActiveRunIds(): string[] {
    return [...controllers.keys()];
  }

  const operations: BashOperations = {
    exec: async (command, cwd, options) => {
      const id = randomUUID();
      const local = new AbortController();
      controllers.set(id, local);

      const onOuterAbort = () => local.abort();
      if (options.signal) {
        if (options.signal.aborted) local.abort();
        else options.signal.addEventListener("abort", onOuterAbort, { once: true });
      }

      const startedAt = Date.now();
      hooks.onStarted({
        id,
        sessionId: hooks.sessionId,
        workspaceRoot: hooks.workspaceRoot,
        command,
        cwd,
        startedAt,
      });

      try {
        return await base.exec(command, cwd, {
          ...options,
          signal: local.signal,
          onData: (data) => {
            const chunk = data.toString("utf8");
            hooks.onOutput(id, chunk);
            options.onData(data);
          },
        });
      } finally {
        options.signal?.removeEventListener("abort", onOuterAbort);
        controllers.delete(id);
        hooks.onEnded(id);
      }
    },
  };

  return { operations, terminateRun, endAllRuns, getActiveRunIds };
}

import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getShellConfig, type BashOperations } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);

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

type ActiveRun = {
  controller: AbortController;
  shellPid?: number;
  /** Surviving descendant PIDs kept after the shell exits (background services). */
  survivors: Set<number>;
};

function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        detached: true,
      }).unref();
    } catch {
      // ignore
    }
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // ignore process-group kill failure
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // ignore
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function listDirectChildren(pid: number): Promise<number[]> {
  if (!Number.isFinite(pid) || pid <= 0) return [];
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync(
        "wmic",
        ["process", "where", `ParentProcessId=${pid}`, "get", "ProcessId", "/value"],
        { windowsHide: true, timeout: 3_000 },
      );
      const ids: number[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        const m = /^ProcessId=(\d+)\s*$/i.exec(line.trim());
        if (m) ids.push(Number(m[1]));
      }
      return ids.filter((n) => Number.isFinite(n) && n > 0);
    }
    const { stdout } = await execFileAsync("pgrep", ["-P", String(pid)], {
      timeout: 3_000,
    });
    return stdout
      .split(/\s+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

async function collectDescendants(rootPid: number, cap = 64): Promise<Set<number>> {
  const found = new Set<number>();
  const queue = [rootPid];
  while (queue.length && found.size < cap) {
    const pid = queue.shift()!;
    const kids = await listDirectChildren(pid);
    for (const kid of kids) {
      if (found.has(kid)) continue;
      found.add(kid);
      queue.push(kid);
    }
  }
  return found;
}

function waitForChildExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
}

async function waitForSurvivorsExit(
  survivors: Set<number>,
  signal?: AbortSignal,
): Promise<void> {
  while (survivors.size > 0) {
    if (signal?.aborted) return;
    for (const pid of [...survivors]) {
      if (!isPidAlive(pid)) survivors.delete(pid);
    }
    if (survivors.size === 0) return;
    await new Promise<void>((r) => setTimeout(r, 1_000));
  }
}

/**
 * Track bash invocations for the Running panel.
 * When `base` is omitted, uses a local shell that keeps tracking background
 * descendants after the shell exits (until they die or the user terminates).
 */
export function createTrackedBashOperations(
  base: BashOperations | undefined,
  hooks: BashRunTrackerHooks,
): {
  operations: BashOperations;
  terminateRun: (runId: string) => boolean;
  endAllRuns: () => void;
  getActiveRunIds: () => string[];
} {
  const active = new Map<string, ActiveRun>();

  function terminateRun(runId: string): boolean {
    const row = active.get(runId);
    if (!row) return false;
    row.controller.abort();
    if (row.shellPid) killProcessTree(row.shellPid);
    for (const pid of row.survivors) killProcessTree(pid);
    return true;
  }

  function endAllRuns(): void {
    for (const id of [...active.keys()]) terminateRun(id);
  }

  function getActiveRunIds(): string[] {
    return [...active.keys()];
  }

  /** Test / inject path: wrap an existing BashOperations without OS spawn. */
  if (base) {
    const operations: BashOperations = {
      exec: async (command, cwd, options) => {
        const id = randomUUID();
        const local = new AbortController();
        active.set(id, { controller: local, survivors: new Set() });

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
          active.delete(id);
          hooks.onEnded(id);
        }
      },
    };
    return { operations, terminateRun, endAllRuns, getActiveRunIds };
  }

  const operations: BashOperations = {
    exec: async (command, cwd, options) => {
      const id = randomUUID();
      const local = new AbortController();
      const row: ActiveRun = { controller: local, survivors: new Set() };
      active.set(id, row);

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
        if (local.signal.aborted) throw new Error("aborted");
        try {
          await fsAccess(cwd, constants.F_OK);
        } catch {
          throw new Error(
            `Working directory does not exist: ${cwd}\nCannot execute bash commands.`,
          );
        }

        const shellConfig = getShellConfig();
        const commandFromStdin = shellConfig.commandTransport === "stdin";
        const child = spawn(
          shellConfig.shell,
          commandFromStdin ? shellConfig.args : [...shellConfig.args, command],
          {
            cwd,
            detached: process.platform !== "win32",
            env: options.env ?? { ...process.env },
            stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
            windowsHide: true,
          },
        );
        if (commandFromStdin) {
          child.stdin?.on("error", () => {});
          child.stdin?.end(command);
        }

        if (child.pid) {
          row.shellPid = child.pid;
          hooks.onStarted({
            id,
            sessionId: hooks.sessionId,
            workspaceRoot: hooks.workspaceRoot,
            command,
            cwd,
            startedAt,
            pid: child.pid,
          });
        }

        const onAbort = () => {
          if (child.pid) killProcessTree(child.pid);
          for (const pid of row.survivors) killProcessTree(pid);
        };
        if (local.signal.aborted) onAbort();
        else local.signal.addEventListener("abort", onAbort, { once: true });

        child.stdout?.on("data", (data: Buffer) => {
          const chunk = data.toString("utf8");
          hooks.onOutput(id, chunk);
          options.onData(data);
        });
        child.stderr?.on("data", (data: Buffer) => {
          const chunk = data.toString("utf8");
          hooks.onOutput(id, chunk);
          options.onData(data);
        });

        const sample = setInterval(() => {
          if (!child.pid) return;
          void collectDescendants(child.pid).then((kids) => {
            for (const kid of kids) row.survivors.add(kid);
          });
        }, 750);

        let exitCode: number | null = null;
        try {
          exitCode = await waitForChildExit(child);
        } finally {
          clearInterval(sample);
        }

        if (local.signal.aborted) throw new Error("aborted");

        if (child.pid) {
          const late = await collectDescendants(child.pid);
          for (const kid of late) row.survivors.add(kid);
          row.survivors.delete(child.pid);
        }
        for (const pid of [...row.survivors]) {
          if (!isPidAlive(pid)) row.survivors.delete(pid);
        }
        if (row.survivors.size > 0) {
          hooks.onOutput(
            id,
            `\n[pi-desktop] shell exited; tracking ${row.survivors.size} background process(es)…\n`,
          );
          await waitForSurvivorsExit(row.survivors, local.signal);
          if (local.signal.aborted) throw new Error("aborted");
        }

        return { exitCode };
      } finally {
        options.signal?.removeEventListener("abort", onOuterAbort);
        active.delete(id);
        hooks.onEnded(id);
      }
    },
  };

  return { operations, terminateRun, endAllRuns, getActiveRunIds };
}

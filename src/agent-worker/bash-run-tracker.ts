import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getShellConfig, type BashOperations } from "@earendil-works/pi-coding-agent";
import { stripBashBackgroundMarker } from "../shared/bash-background";

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
  /** Fired when the bash tool detaches; process may still be running. */
  onBackgrounded?: (runId: string) => void;
  /** Defense-in-depth permission check before shell spawn (bash only). */
  beforeExec?: (command: string) => void;
  /** When true, start detached from the tool call (permission "后台运行"). */
  shouldStartBackground?: (command: string) => boolean;
};

type ActiveRun = {
  controller: AbortController;
  shellPid?: number;
  /** Surviving descendant PIDs kept after the shell exits (background services). */
  survivors: Set<number>;
  backgrounded: boolean;
  /** Forwards to the bash tool until backgrounded. */
  toolOnData: ((data: Buffer) => void) | null;
  resolveTool: ((result: { exitCode: number | null }) => void) | null;
  rejectTool: ((err: Error) => void) | null;
  removeOuterAbort: (() => void) | null;
};

const BACKGROUND_NOTICE =
  "\n[pi-desktop] Running in background — conversation continues; output is in the Running panel.\n";

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
      // Prefer CIM — `wmic` is removed on many Win11 installs.
      try {
        const { stdout } = await execFileAsync(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}").ProcessId`,
          ],
          { windowsHide: true, timeout: 4_000 },
        );
        return stdout
          .split(/\s+/)
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 0);
      } catch {
        // fall through to wmic
      }
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
 *
 * A run can be detached from the agent tool (`backgroundRun` / start-as-background)
 * while the OS process keeps running — stdout/stderr continue to be drained so
 * macOS/Linux servers don't die on SIGPIPE.
 */
export function createTrackedBashOperations(
  base: BashOperations | undefined,
  hooks: BashRunTrackerHooks,
): {
  operations: BashOperations;
  terminateRun: (runId: string) => boolean;
  backgroundRun: (runId: string) => boolean;
  endAllRuns: () => void;
  getActiveRunIds: () => string[];
} {
  const active = new Map<string, ActiveRun>();

  function detachTool(row: ActiveRun, runId: string, notice: boolean): boolean {
    if (row.backgrounded) return false;
    row.backgrounded = true;
    if (notice && row.toolOnData) {
      try {
        row.toolOnData(Buffer.from(BACKGROUND_NOTICE));
      } catch {
        // ignore
      }
    }
    hooks.onOutput(runId, BACKGROUND_NOTICE);
    row.toolOnData = null;
    row.removeOuterAbort?.();
    row.removeOuterAbort = null;
    const resolve = row.resolveTool;
    row.resolveTool = null;
    row.rejectTool = null;
    resolve?.({ exitCode: null });
    hooks.onBackgrounded?.(runId);
    return true;
  }

  function backgroundRun(runId: string): boolean {
    const row = active.get(runId);
    if (!row || row.backgrounded) return false;
    return detachTool(row, runId, true);
  }

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

  function bindOuterAbort(row: ActiveRun, signal: AbortSignal | undefined): void {
    if (!signal) return;
    const onOuterAbort = () => {
      if (row.backgrounded) return;
      row.controller.abort();
    };
    if (signal.aborted) {
      onOuterAbort();
      return;
    }
    signal.addEventListener("abort", onOuterAbort);
    row.removeOuterAbort = () => signal.removeEventListener("abort", onOuterAbort);
  }

  /** Test / inject path: wrap an existing BashOperations without OS spawn. */
  if (base) {
    const operations: BashOperations = {
      exec: async (command, cwd, options) => {
        const { command: spawnCommand } = stripBashBackgroundMarker(command);
        hooks.beforeExec?.(spawnCommand);
        const startBg = Boolean(hooks.shouldStartBackground?.(command));
        const id = randomUUID();
        const local = new AbortController();
        const row: ActiveRun = {
          controller: local,
          survivors: new Set(),
          backgrounded: false,
          toolOnData: options.onData,
          resolveTool: null,
          rejectTool: null,
          removeOuterAbort: null,
        };
        active.set(id, row);
        bindOuterAbort(row, options.signal);

        const startedAt = Date.now();
        hooks.onStarted({
          id,
          sessionId: hooks.sessionId,
          workspaceRoot: hooks.workspaceRoot,
          command: spawnCommand,
          cwd,
          startedAt,
        });

        const toolPromise = new Promise<{ exitCode: number | null }>((resolve, reject) => {
          row.resolveTool = resolve;
          row.rejectTool = reject;
        });

        void (async () => {
          try {
            const result = await base.exec(spawnCommand, cwd, {
              ...options,
              signal: local.signal,
              onData: (data) => {
                const chunk = data.toString("utf8");
                hooks.onOutput(id, chunk);
                row.toolOnData?.(data);
              },
            });
            if (!row.backgrounded) {
              row.resolveTool?.(result);
              row.resolveTool = null;
              row.rejectTool = null;
            }
          } catch (err) {
            if (!row.backgrounded) {
              row.rejectTool?.(err instanceof Error ? err : new Error(String(err)));
              row.resolveTool = null;
              row.rejectTool = null;
            }
          } finally {
            row.removeOuterAbort?.();
            active.delete(id);
            hooks.onEnded(id);
          }
        })();

        if (startBg) {
          detachTool(row, id, true);
        }

        return toolPromise;
      },
    };
    return { operations, terminateRun, backgroundRun, endAllRuns, getActiveRunIds };
  }

  const operations: BashOperations = {
    exec: async (command, cwd, options) => {
      const { command: spawnCommand } = stripBashBackgroundMarker(command);
      hooks.beforeExec?.(spawnCommand);
      const startBg = Boolean(hooks.shouldStartBackground?.(command));
      const id = randomUUID();
      const local = new AbortController();
      const row: ActiveRun = {
        controller: local,
        survivors: new Set(),
        backgrounded: false,
        toolOnData: options.onData,
        resolveTool: null,
        rejectTool: null,
        removeOuterAbort: null,
      };
      active.set(id, row);
      bindOuterAbort(row, options.signal);

      const startedAt = Date.now();
      hooks.onStarted({
        id,
        sessionId: hooks.sessionId,
        workspaceRoot: hooks.workspaceRoot,
        command: spawnCommand,
        cwd,
        startedAt,
      });

      const toolPromise = new Promise<{ exitCode: number | null }>((resolve, reject) => {
        row.resolveTool = resolve;
        row.rejectTool = reject;
      });

      void (async () => {
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
            commandFromStdin ? shellConfig.args : [...shellConfig.args, spawnCommand],
            {
              cwd,
              // New process group on macOS/Linux so kill(-pid) terminates the tree.
              detached: process.platform !== "win32",
              env: options.env ?? { ...process.env },
              stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
              windowsHide: true,
            },
          );
          if (commandFromStdin) {
            child.stdin?.on("error", () => {});
            child.stdin?.end(spawnCommand);
          }

          if (child.pid) {
            row.shellPid = child.pid;
            hooks.onStarted({
              id,
              sessionId: hooks.sessionId,
              workspaceRoot: hooks.workspaceRoot,
              command: spawnCommand,
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

          const forward = (data: Buffer) => {
            const chunk = data.toString("utf8");
            hooks.onOutput(id, chunk);
            // Keep draining after detach so background servers don't SIGPIPE.
            row.toolOnData?.(data);
          };
          child.stdout?.on("data", forward);
          child.stderr?.on("data", forward);

          const sample = setInterval(() => {
            if (!child.pid) return;
            void collectDescendants(child.pid).then((kids) => {
              for (const kid of kids) row.survivors.add(kid);
            });
          }, 750);

          if (startBg) {
            detachTool(row, id, true);
          }

          let exitCode: number | null = null;
          try {
            exitCode = await waitForChildExit(child);
          } finally {
            clearInterval(sample);
          }

          if (local.signal.aborted) {
            if (!row.backgrounded) throw new Error("aborted");
            return;
          }

          if (child.pid) {
            const late = await collectDescendants(child.pid);
            for (const kid of late) row.survivors.add(kid);
            row.survivors.delete(child.pid);
          }
          for (const pid of [...row.survivors]) {
            if (!isPidAlive(pid)) row.survivors.delete(pid);
          }

          if (row.backgrounded) {
            // Detached from the tool: still track survivors in Running until they exit.
            if (row.survivors.size > 0) {
              hooks.onOutput(
                id,
                `\n[pi-desktop] shell exited; tracking ${row.survivors.size} background process(es)…\n`,
              );
              await waitForSurvivorsExit(row.survivors, local.signal);
            }
            return;
          }

          if (row.survivors.size > 0) {
            hooks.onOutput(
              id,
              `\n[pi-desktop] shell exited; tracking ${row.survivors.size} background process(es)…\n`,
            );
            await waitForSurvivorsExit(row.survivors, local.signal);
            if (local.signal.aborted) throw new Error("aborted");
          }

          row.resolveTool?.({ exitCode });
          row.resolveTool = null;
          row.rejectTool = null;
        } catch (err) {
          if (!row.backgrounded) {
            row.rejectTool?.(err instanceof Error ? err : new Error(String(err)));
            row.resolveTool = null;
            row.rejectTool = null;
          }
        } finally {
          row.removeOuterAbort?.();
          active.delete(id);
          hooks.onEnded(id);
        }
      })();

      return toolPromise;
    },
  };

  return { operations, terminateRun, backgroundRun, endAllRuns, getActiveRunIds };
}

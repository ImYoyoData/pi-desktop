import { create } from "zustand";
import type { AgentRunEvent, AgentRunSnapshot } from "../../../shared/agent-runs";
import { shouldInterruptBashStall } from "../../../shared/bash-stall";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { getMessage } from "@renderer/services/feedback";
import { t } from "@renderer/i18n";

function normalizeRoot(root: string): string {
  return root.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function matchesWorkspace(runRoot: string, workspaceRoot: string | null): boolean {
  if (!workspaceRoot) return false;
  return normalizeRoot(runRoot) === normalizeRoot(workspaceRoot);
}

type AgentRunsBase = {
  runs: AgentRunSnapshot[];
  selectedId: string | null;
};

type AgentRunsDerived = {
  selected: AgentRunSnapshot | null;
};

type AgentRunsState = AgentRunsBase &
  AgentRunsDerived & {
    applyEvent: (event: AgentRunEvent) => void;
    refresh: (workspaceRoot: string | null) => Promise<void>;
    bind: () => void;
    unbind: () => void;
    terminate: (runId: string) => Promise<void>;
    background: (runId: string) => Promise<void>;
    findBlockingRun: (
      sessionId: string,
      command: string,
    ) => AgentRunSnapshot | null;
    select: (id: string) => void;
    checkBashStalls: () => void;
  };

function derive(base: AgentRunsBase): AgentRunsDerived {
  return {
    selected: base.runs.find((r) => r.id === base.selectedId) ?? null,
  };
}

export const useAgentRunsStore = create<AgentRunsState>()((set, get) => {
  let unsub: (() => void) | null = null;
  let refreshGen = 0;
  let stallTimer: ReturnType<typeof setInterval> | null = null;
  /** Avoid repeat terminate storms for the same run id. */
  const stallTerminating = new Set<string>();

  function writeBase(patch: Partial<AgentRunsBase>): void {
    set((state) => {
      const next = { ...state, ...patch };
      return { ...patch, ...derive(next) };
    });
  }

  function currentWorkspaceRoot(): string | null {
    return useWorkspaceStore.getState().root;
  }

  function syncSelection(
    runs: AgentRunSnapshot[],
    selectedId: string | null,
  ): string | null {
    if (selectedId && !runs.some((r) => r.id === selectedId)) {
      return runs[0]?.id ?? null;
    }
    if (!selectedId && runs.length > 0) return runs[0]!.id;
    return selectedId;
  }

  function applyEvent(event: AgentRunEvent): void {
    const workspaceRoot = currentWorkspaceRoot();
    switch (event.type) {
      case "snapshot": {
        const runs = event.runs.filter((r) =>
          matchesWorkspace(r.workspaceRoot, workspaceRoot),
        );
        const selectedId = get().selectedId;
        writeBase({
          runs,
          selectedId:
            selectedId && !runs.some((r) => r.id === selectedId)
              ? runs[0]?.id ?? null
              : selectedId,
        });
        break;
      }
      case "upsert": {
        if (!matchesWorkspace(event.run.workspaceRoot, workspaceRoot)) return;
        const runs = get().runs;
        const i = runs.findIndex((r) => r.id === event.run.id);
        const next =
          i >= 0
            ? runs.map((r, idx) => (idx === i ? event.run : r))
            : [...runs, event.run];
        writeBase({ runs: next, selectedId: get().selectedId || event.run.id });
        break;
      }
      case "output": {
        const runs = get().runs;
        const i = runs.findIndex((r) => r.id === event.runId);
        if (i < 0) return;
        const prev = runs[i]!;
        writeBase({
          runs: runs.map((r, idx) =>
            idx === i
              ? { ...prev, outputTail: event.outputTail, lastOutputAt: Date.now() }
              : r,
          ),
        });
        break;
      }
      case "ended": {
        stallTerminating.delete(event.runId);
        const runs = get().runs.filter((r) => r.id !== event.runId);
        const selectedId = get().selectedId;
        writeBase({
          runs,
          selectedId:
            selectedId === event.runId ? runs[0]?.id ?? null : selectedId,
        });
        break;
      }
      default: {
        const _never: never = event;
        void _never;
      }
    }
  }

  async function refresh(workspaceRoot: string | null): Promise<void> {
    const gen = ++refreshGen;
    if (!workspaceRoot) {
      writeBase({ runs: [], selectedId: null });
      return;
    }
    // Drop other-workspace rows immediately so UI never shows a stale Scope B mix.
    const filtered = get().runs.filter((r) =>
      matchesWorkspace(r.workspaceRoot, workspaceRoot),
    );
    writeBase({
      runs: filtered,
      selectedId: syncSelection(filtered, get().selectedId),
    });

    const list = await window.api.runs.list(workspaceRoot);
    if (gen !== refreshGen) return;

    const next = list.filter((r) =>
      matchesWorkspace(r.workspaceRoot, workspaceRoot),
    );
    writeBase({ runs: next, selectedId: syncSelection(next, get().selectedId) });
  }

  async function terminate(runId: string): Promise<void> {
    await window.api.runs.terminate(runId);
  }

  async function background(runId: string): Promise<void> {
    await window.api.runs.background(runId);
  }

  function checkBashStalls(): void {
    const now = Date.now();
    for (const run of get().runs) {
      if (stallTerminating.has(run.id)) continue;
      if (
        !shouldInterruptBashStall({
          status: run.status,
          detached: run.detached,
          startedAt: run.startedAt,
          lastOutputAt: run.lastOutputAt ?? run.startedAt,
        }, now)
      ) {
        continue;
      }
      stallTerminating.add(run.id);
      void terminate(run.id)
        .then(() => {
          getMessage().warning(t.bashStallInterrupted);
        })
        .catch(() => {
          stallTerminating.delete(run.id);
          getMessage().error(t.runningTerminateFailed);
        });
    }
  }

  function bind(): void {
    unsub?.();
    unsub = window.api.runs.onEvent(applyEvent);
    if (!stallTimer) {
      stallTimer = setInterval(() => checkBashStalls(), 5_000);
    }
  }

  function unbind(): void {
    unsub?.();
    unsub = null;
    if (stallTimer) {
      clearInterval(stallTimer);
      stallTimer = null;
    }
  }

  /** Prefer newest non-detached run matching session + command (tool card → Running). */
  function findBlockingRun(
    sessionId: string,
    command: string,
  ): AgentRunSnapshot | null {
    const cmd = command.trim();
    if (!cmd) return null;
    let best: AgentRunSnapshot | null = null;
    for (const run of get().runs) {
      if (run.sessionId !== sessionId) continue;
      if (run.detached) continue;
      if (run.command.trim() !== cmd) continue;
      if (!best || run.startedAt >= best.startedAt) best = run;
    }
    return best;
  }

  function select(id: string): void {
    writeBase({ selectedId: id });
  }

  const base: AgentRunsBase = { runs: [], selectedId: null };

  return {
    ...base,
    ...derive(base),
    applyEvent,
    refresh,
    bind,
    unbind,
    terminate,
    background,
    findBlockingRun,
    select,
    checkBashStalls,
  };
});

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { AgentRunEvent, AgentRunSnapshot } from "../../../shared/agent-runs";
import { useWorkspaceStore } from "@renderer/stores/workspace";

function normalizeRoot(root: string): string {
  return root.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function matchesWorkspace(runRoot: string, workspaceRoot: string | null): boolean {
  if (!workspaceRoot) return false;
  return normalizeRoot(runRoot) === normalizeRoot(workspaceRoot);
}

export const useAgentRunsStore = defineStore("agentRuns", () => {
  const runs = ref<AgentRunSnapshot[]>([]);
  const selectedId = ref<string | null>(null);
  let unsub: (() => void) | null = null;
  let refreshGen = 0;

  const selected = computed(
    () => runs.value.find((r) => r.id === selectedId.value) ?? null,
  );

  function currentWorkspaceRoot(): string | null {
    return useWorkspaceStore().root;
  }

  function applyEvent(event: AgentRunEvent): void {
    const workspaceRoot = currentWorkspaceRoot();
    switch (event.type) {
      case "snapshot": {
        runs.value = event.runs.filter((r) =>
          matchesWorkspace(r.workspaceRoot, workspaceRoot),
        );
        if (selectedId.value && !runs.value.some((r) => r.id === selectedId.value)) {
          selectedId.value = runs.value[0]?.id ?? null;
        }
        break;
      }
      case "upsert": {
        if (!matchesWorkspace(event.run.workspaceRoot, workspaceRoot)) return;
        const i = runs.value.findIndex((r) => r.id === event.run.id);
        if (i >= 0) {
          runs.value = runs.value.map((r, idx) => (idx === i ? event.run : r));
        } else {
          runs.value = [...runs.value, event.run];
        }
        if (!selectedId.value) selectedId.value = event.run.id;
        break;
      }
      case "output": {
        const i = runs.value.findIndex((r) => r.id === event.runId);
        if (i < 0) return;
        const prev = runs.value[i]!;
        runs.value = runs.value.map((r, idx) =>
          idx === i ? { ...prev, outputTail: event.outputTail } : r,
        );
        break;
      }
      case "ended": {
        runs.value = runs.value.filter((r) => r.id !== event.runId);
        if (selectedId.value === event.runId) {
          selectedId.value = runs.value[0]?.id ?? null;
        }
        break;
      }
      default: {
        const _never: never = event;
        void _never;
      }
    }
  }

  function syncSelection(): void {
    if (selectedId.value && !runs.value.some((r) => r.id === selectedId.value)) {
      selectedId.value = runs.value[0]?.id ?? null;
    } else if (!selectedId.value && runs.value.length > 0) {
      selectedId.value = runs.value[0]!.id;
    }
  }

  async function refresh(workspaceRoot: string | null): Promise<void> {
    const gen = ++refreshGen;
    if (!workspaceRoot) {
      runs.value = [];
      selectedId.value = null;
      return;
    }
    // Drop other-workspace rows immediately so UI never shows a stale Scope B mix.
    runs.value = runs.value.filter((r) =>
      matchesWorkspace(r.workspaceRoot, workspaceRoot),
    );
    syncSelection();

    const list = await window.api.runs.list(workspaceRoot);
    if (gen !== refreshGen) return;

    runs.value = list.filter((r) => matchesWorkspace(r.workspaceRoot, workspaceRoot));
    syncSelection();
  }

  function bind(): void {
    unsub?.();
    unsub = window.api.runs.onEvent(applyEvent);
  }

  function unbind(): void {
    unsub?.();
    unsub = null;
  }

  async function terminate(runId: string): Promise<void> {
    await window.api.runs.terminate(runId);
  }

  function select(id: string): void {
    selectedId.value = id;
  }

  return {
    runs,
    selectedId,
    selected,
    applyEvent,
    refresh,
    bind,
    unbind,
    terminate,
    select,
  };
});

import fs from "node:fs";
import path from "node:path";

export type WorkspacePersistedState = {
  root: string | null;
  recent: string[];
};

const DEFAULT_STATE: WorkspacePersistedState = { root: null, recent: [] };

function readState(statePath: string): WorkspacePersistedState {
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<WorkspacePersistedState>;
    return {
      root: typeof parsed.root === "string" ? parsed.root : null,
      recent: Array.isArray(parsed.recent)
        ? parsed.recent.filter((entry): entry is string => typeof entry === "string")
        : [],
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writeState(statePath: string, state: WorkspacePersistedState): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

export function createWorkspaceStore(statePath: string) {
  let state = readState(statePath);

  const persist = (): void => {
    writeState(statePath, state);
  };

  return {
    getRoot(): string | null {
      return state.root;
    },

    setRoot(root: string | null): void {
      state = { ...state, root };
      persist();
    },

    /**
     * Add by append order (first-added stays first). Re-opening an existing
     * root does NOT move it — order is fixed until reorderRecent / remove.
     */
    addRecent(root: string): void {
      if (state.recent.includes(root)) {
        return;
      }
      state = { ...state, recent: [...state.recent, root] };
      persist();
    },

    listRecent(): string[] {
      return [...state.recent];
    },

    /** Persist a user-defined order (e.g. drag-and-drop). */
    reorderRecent(order: string[]): void {
      const known = new Set(state.recent);
      const next = order.filter((entry) => known.has(entry));
      for (const entry of state.recent) {
        if (!next.includes(entry)) next.push(entry);
      }
      if (next.length === state.recent.length && next.every((p, i) => p === state.recent[i])) {
        return;
      }
      state = { ...state, recent: next };
      persist();
    },

    removeRecent(root: string): void {
      const recent = state.recent.filter((entry) => entry !== root);
      const nextRoot = state.root === root ? (recent[0] ?? null) : state.root;
      state = { ...state, recent, root: nextRoot };
      persist();
    },
  };
}

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

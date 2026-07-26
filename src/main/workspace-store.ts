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

    addRecent(root: string): void {
      const recent = [root, ...state.recent.filter((entry) => entry !== root)];
      state = { ...state, recent };
      persist();
    },

    listRecent(): string[] {
      return [...state.recent];
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

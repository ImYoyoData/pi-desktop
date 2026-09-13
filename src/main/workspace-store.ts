import fs from "node:fs";
import path from "node:path";

export type WorkspacePersistedState = {
  root: string | null;
  recent: string[];
  /** Pi-discovered workspaces the user removed from the sidebar. */
  dismissedPi: string[];
};

const DEFAULT_STATE: WorkspacePersistedState = {
  root: null,
  recent: [],
  dismissedPi: [],
};

/**
 * Trimmed stored form of a workspace path, or null when the input is not usable.
 *
 * This guard matters because paths are resolved against the process cwd all over
 * the app: a blank entry used to survive as `""` and then become
 * `path.resolve("")` — i.e. the app's own working directory — which the sidebar
 * rendered as an extra, nameless workspace. Rejecting blanks here stops them
 * entering the store and purges the ones older builds left behind.
 *
 * The path itself is stored verbatim (not resolved): the store keeps the
 * caller's spelling, and callers/resolvers normalise for comparison.
 */
export function normalizeStoredWorkspacePath(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readState(statePath: string): WorkspacePersistedState {
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<WorkspacePersistedState>;
    return {
      root: normalizeStoredWorkspacePath(parsed.root),
      // Drop non-strings AND blanks left behind by older builds, which used to
      // surface as a duplicate blank workspace once resolved against the cwd.
      recent: Array.isArray(parsed.recent)
        ? parsed.recent
            .map((entry) => normalizeStoredWorkspacePath(entry))
            .filter((entry): entry is string => entry !== null)
        : [],
      dismissedPi: Array.isArray(parsed.dismissedPi)
        ? parsed.dismissedPi
            .map((entry) => normalizeStoredWorkspacePath(entry))
            .filter((entry): entry is string => entry !== null)
        : [],
    };
  } catch {
    return { ...DEFAULT_STATE, recent: [], dismissedPi: [] };
  }
}

function writeState(statePath: string, state: WorkspacePersistedState): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

function pathKey(input: string): string {
  const resolved = path.resolve(input.trim());
  // Windows and macOS (default APFS) are case-insensitive — fold both.
  return process.platform === "win32" || process.platform === "darwin"
    ? resolved.toLowerCase()
    : resolved;
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
      state = { ...state, root: normalizeStoredWorkspacePath(root) };
      persist();
    },

    /**
     * Add by append order (first-added stays first). Re-opening an existing
     * root does NOT move it — order is fixed until reorderRecent / remove.
     */
    addRecent(root: string): void {
      const stored = normalizeStoredWorkspacePath(root);
      if (!stored) return;
      const dismissedPi = state.dismissedPi.filter((entry) => pathKey(entry) !== pathKey(stored));
      if (state.recent.some((entry) => pathKey(entry) === pathKey(stored))) {
        if (dismissedPi.length !== state.dismissedPi.length) {
          state = { ...state, dismissedPi };
          persist();
        }
        return;
      }
      state = {
        ...state,
        recent: [...state.recent, stored],
        dismissedPi,
      };
      persist();
    },

    listRecent(): string[] {
      return [...state.recent];
    },

    listDismissedPi(): string[] {
      return [...state.dismissedPi];
    },

    /** Persist a user-defined order (e.g. drag-and-drop). */
    reorderRecent(order: string[]): void {
      const known = new Set(state.recent.map(pathKey));
      const next = order.filter((entry) => known.has(pathKey(entry)));
      for (const entry of state.recent) {
        if (!next.some((p) => pathKey(p) === pathKey(entry))) next.push(entry);
      }
      if (next.length === state.recent.length && next.every((p, i) => p === state.recent[i])) {
        return;
      }
      state = { ...state, recent: next };
      persist();
    },

    /**
     * Close / hide: drop from the main list but keep in dismissedPi so the
     * workspace can be reopened from "Closed workspaces".
     */
    removeRecent(root: string): void {
      const stored = normalizeStoredWorkspacePath(root) ?? root;
      const recent = state.recent.filter((entry) => pathKey(entry) !== pathKey(stored));
      const nextRoot =
        state.root && pathKey(state.root) === pathKey(stored) ? (recent[0] ?? null) : state.root;
      const dismissedPi = state.dismissedPi.some((entry) => pathKey(entry) === pathKey(stored))
        ? state.dismissedPi
        : [...state.dismissedPi, stored];
      state = { ...state, recent, root: nextRoot, dismissedPi };
      persist();
    },

    /**
     * Forget entirely: remove from recent AND dismissedPi (no "closed" entry).
     * Does not touch the project folder or Pi session files — callers purge those.
     */
    forget(root: string): void {
      const key = pathKey(root);
      const recent = state.recent.filter((entry) => pathKey(entry) !== key);
      const dismissedPi = state.dismissedPi.filter((entry) => pathKey(entry) !== key);
      const nextRoot = state.root && pathKey(state.root) === key ? (recent[0] ?? null) : state.root;
      state = { ...state, recent, dismissedPi, root: nextRoot };
      persist();
    },
  };
}

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

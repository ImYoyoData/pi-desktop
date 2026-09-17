import fs from "node:fs";
import path from "node:path";

export type WorkspacePersistedState = {
  root: string | null;
  recent: string[];
  /** Pi-discovered workspaces the user removed from the sidebar. */
  dismissedPi: string[];
  /** 绝对路径 → 用户自定义的工作区显示名。 */
  aliases: Record<string, string>;
  /** 自定义分类名，顺序即菜单顺序；未归类的工作区归入内置“默认”。 */
  groups: string[];
  /** 绝对路径 → 分类名。 */
  groupOf: Record<string, string>;
};

const DEFAULT_STATE: WorkspacePersistedState = {
  root: null,
  recent: [],
  dismissedPi: [],
  aliases: {},
  groups: [],
  groupOf: {},
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

function readAliases(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const name = typeof value === "string" ? value.trim() : "";
    if (key.trim() && name) out[key] = name;
  }
  return out;
}

function readNames(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const entry of input) {
    const name = typeof entry === "string" ? entry.trim() : "";
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

function readGroupOf(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const name = typeof value === "string" ? value.trim() : "";
    const target = normalizeStoredWorkspacePath(key);
    if (target && name) out[target] = name;
  }
  return out;
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
      aliases: readAliases(parsed.aliases),
      groups: readNames(parsed.groups),
      groupOf: readGroupOf(parsed.groupOf),
    };
  } catch {
    return { ...DEFAULT_STATE };
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

/** 别名键用原样绝对路径，方便渲染进程直接按 root 查表。 */
function aliasKey(input: string): string {
  return path.resolve(input.trim());
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

    listAliases(): Record<string, string> {
      return { ...state.aliases };
    },

    listGroups(): { groups: string[]; groupOf: Record<string, string> } {
      return { groups: [...state.groups], groupOf: { ...state.groupOf } };
    },

    addGroup(name: string): void {
      const trimmed = name.trim();
      if (!trimmed || state.groups.includes(trimmed)) return;
      state = { ...state, groups: [...state.groups, trimmed] };
      persist();
    },

    renameGroup(from: string, to: string): void {
      const next = to.trim();
      if (!next || next === from || !state.groups.includes(from)) return;
      const groups = [...new Set(state.groups.map((g) => (g === from ? next : g)))];
      const groupOf: Record<string, string> = {};
      for (const [key, value] of Object.entries(state.groupOf)) {
        groupOf[key] = value === from ? next : value;
      }
      state = { ...state, groups, groupOf };
      persist();
    },

    /** 删除分类，其中的工作区回到内置“默认”。 */
    removeGroup(name: string): void {
      if (!state.groups.includes(name)) return;
      const groups = state.groups.filter((g) => g !== name);
      const groupOf: Record<string, string> = {};
      for (const [key, value] of Object.entries(state.groupOf)) {
        if (value !== name) groupOf[key] = value;
      }
      state = { ...state, groups, groupOf };
      persist();
    },

    /** group 为 null / 空串时回到内置“默认”。 */
    setGroupOf(root: string, group: string | null): void {
      const key = aliasKey(root);
      const trimmed = group?.trim();
      const groupOf = { ...state.groupOf };
      if (trimmed) groupOf[key] = trimmed;
      else delete groupOf[key];
      state = { ...state, groupOf };
      persist();
    },

    setAlias(root: string, name: string | null): void {
      const key = aliasKey(root);
      const trimmed = name?.trim();
      const aliases = { ...state.aliases };
      if (trimmed) aliases[key] = trimmed;
      else for (const k of Object.keys(aliases)) if (pathKey(k) === pathKey(root)) delete aliases[k];
      state = { ...state, aliases };
      persist();
    },

    /** 重新定位：旧路径的整体记录（root / recent / dismissedPi / 别名）换成新路径。 */
    replacePath(from: string, to: string): void {
      const fromKey = pathKey(from);
      const stored = normalizeStoredWorkspacePath(to);
      if (!stored) return;
      const swap = (entry: string): string =>
        pathKey(entry) === fromKey ? stored : entry;
      const seen = new Set<string>();
      const dedupe = (list: string[]): string[] =>
        list.filter((entry) => {
          const key = pathKey(entry);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      const recent = dedupe(state.recent.map(swap));
      seen.clear();
      const dismissedPi = dedupe(state.dismissedPi.map(swap));
      const aliases: Record<string, string> = {};
      for (const [key, name] of Object.entries(state.aliases)) {
        aliases[pathKey(key) === fromKey ? aliasKey(stored) : key] = name;
      }
      const groupOf: Record<string, string> = {};
      for (const [key, name] of Object.entries(state.groupOf)) {
        groupOf[pathKey(key) === fromKey ? aliasKey(stored) : key] = name;
      }
      state = {
        ...state,
        recent,
        dismissedPi,
        aliases,
        groupOf,
        root:
          state.root && pathKey(state.root) === fromKey ? stored : state.root,
      };
      persist();
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
      const aliases = { ...state.aliases };
      for (const k of Object.keys(aliases)) if (pathKey(k) === key) delete aliases[k];
      const groupOf = { ...state.groupOf };
      for (const k of Object.keys(groupOf)) if (pathKey(k) === key) delete groupOf[k];
      const nextRoot = state.root && pathKey(state.root) === key ? (recent[0] ?? null) : state.root;
      state = { ...state, recent, dismissedPi, aliases, groupOf, root: nextRoot };
      persist();
    },
  };
}

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

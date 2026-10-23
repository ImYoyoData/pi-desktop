import { create } from "zustand";
import { subscribeLocale, t } from "@renderer/i18n";
import { clearTabHistory } from "@renderer/stores/browser-library";
import { uniquePreviewTabLabel } from "@renderer/utils/preview-tab-label";
import { localizedTabLabel } from "@renderer/utils/right-tab-labels";
import * as prefs from "@renderer/utils/prefs";
import type { ProgramStatusReport } from "@renderer/utils/osc-program-status";

export type RightTabKind =
  | "running"
  | "changes"
  | "files"
  | "browser"
  | "terminal"
  | "preview";

export type RightTab = {
  id: string;
  kind: RightTabKind;
  label: string;
  /**
   * When true, auto-title from browser page / first terminal command
   * must not overwrite (user renamed).
   */
  labelLocked?: boolean;
  /** For preview tabs */
  filePath?: string;
  dirty?: boolean;
  /** Git status code: M/A/U/D/R/C */
  gitCode?: string;
  /** File missing on disk */
  missing?: boolean;
  /**
   * Preview tabs start transient: opening another file reuses this tab
   * until the user edits (then it becomes permanent).
   */
  transient?: boolean;
  /** Terminal: node-pty id (session-scoped; kept while parking workspaces). */
  ptyId?: string;
  /** Terminal: cwd used when the pty was created (restored after restart). */
  cwd?: string;
  /** Terminal: shell id chosen for this tab (empty = default shell). */
  shellId?: string;
  /** Terminal: pi 等程序经 OSC 7501 上报的运行状态。 */
  piStatus?: ProgramStatusReport;
  /** Browser: last address-bar URL (restored after restart). */
  url?: string;
};

let tabSeq = 0;
function nextTabId(kind: RightTabKind): string {
  tabSeq += 1;
  return `${kind}-${tabSeq}`;
}

type SaveHandler = () => Promise<boolean>;

type PersistedTabs = {
  tabs: Array<{
    kind: RightTabKind;
    label: string;
    filePath?: string;
    transient?: boolean;
    labelLocked?: boolean;
    cwd?: string;
    shellId?: string;
    ptyId?: string;
    url?: string;
  }>;
  activeIndex: number;
};

const TABS_STORAGE_PREFIX = "pi-desktop:right-tabs:v2:";

function storageKey(root: string): string {
  return `${TABS_STORAGE_PREFIX}${root.replace(/\\/g, "/").toLowerCase()}`;
}

function normalizeRoot(root: string): string {
  return root.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

type ParkedWorkspace = {
  tabs: RightTab[];
  activeId: string;
  panelActiveId: string;
};

/** In-memory park so terminal PTYs stay alive across workspace switches. */
const parkedByRoot = new Map<string, ParkedWorkspace>();

/** Bottom panel hosts terminals (VSCode 面板); the right pane hosts the rest. */
function isPanelTab(tab: RightTab): boolean {
  return tab.kind === "terminal";
}

function cloneTabs(list: RightTab[]): RightTab[] {
  return list.map((tab) => ({ ...tab }));
}

function defaultTabs(): RightTab[] {
  return [];
}

/** Re-apply active-locale labels after restore / language switch. */
function syncLocalizedLabels(list: RightTab[]): RightTab[] {
  return list.map((tab) => {
    const next = localizedTabLabel(tab);
    return tab.label === next ? tab : { ...tab, label: next };
  });
}

/** Disambiguate same-basename preview tabs (e.g. src/index.ts vs lib/index.ts). */
function refreshPreviewTabLabels(list: RightTab[]): RightTab[] {
  const paths = list
    .filter((tab) => tab.kind === "preview" && tab.filePath)
    .map((tab) => tab.filePath!);
  return list.map((tab) => {
    if (tab.kind !== "preview" || tab.labelLocked || !tab.filePath) return tab;
    const next = uniquePreviewTabLabel(tab.filePath, paths);
    return tab.label === next ? tab : { ...tab, label: next };
  });
}

function defaultTabLabel(
  kind: RightTabKind,
  counts: number,
  opts?: { label?: string; filePath?: string },
): string {
  if (opts?.label) return opts.label;
  switch (kind) {
    case "running":
      return t.runningTab;
    case "changes":
      return t.changesTab;
    case "files":
      return t.filesTab;
    case "browser":
      return counts === 0 ? t.browser : t.browserLabel(counts + 1);
    case "terminal":
      return counts === 0 ? t.terminal : t.terminalLabel(counts + 1);
    case "preview":
      return opts?.filePath?.split(/[/\\]/).pop() ?? t.preview;
    default: {
      const _never: never = kind;
      return String(_never);
    }
  }
}

type RightTabsBase = {
  tabs: RightTab[];
  activeId: string;
  panelActiveId: string;
  /** Right-pane Changes dock view asks the Changes tab to open this file's diff. */
  changesRevealPath: string;
  changesRevealTick: number;
};

type RightTabsDerived = {
  /** Right-dock tabs — everything except the panel's terminals. */
  dockTabs: RightTab[];
  panelTabs: RightTab[];
  activeTab: RightTab | null;
  activePanelTab: RightTab | null;
};

function derive(base: RightTabsBase): RightTabsDerived {
  const dockTabs = base.tabs.filter((tab) => !isPanelTab(tab));
  const panelTabs = base.tabs.filter(isPanelTab);
  return {
    dockTabs,
    panelTabs,
    activeTab: dockTabs.find((tab) => tab.id === base.activeId) ?? null,
    activePanelTab: panelTabs.find((tab) => tab.id === base.panelActiveId) ?? null,
  };
}

export type RightTabsState = RightTabsBase &
  RightTabsDerived & {
    selectTab: (id: string) => void;
    selectPanelTab: (id: string) => void;
    closeTab: (id: string) => void;
    closeAllPreviewTabs: () => void;
    patchTab: (id: string, patch: Partial<RightTab>) => void;
    autoTitleTab: (id: string, label: string) => void;
    setPiStatus: (id: string, status: ProgramStatusReport | null) => void;
    renameTab: (id: string, label: string) => void;
    addTab: (
      kind: RightTabKind,
      opts?: { label?: string; filePath?: string; cwd?: string; shellId?: string },
    ) => RightTab;
    revealInChanges: (path: string) => void;
    addPreviewFromPicker: () => Promise<void>;
    registerSaveHandler: (id: string, handler: SaveHandler) => void;
    unregisterSaveHandler: (id: string) => void;
    saveTab: (id: string) => Promise<boolean>;
    refreshPreviewGitMeta: () => Promise<void>;
    reorderTabs: (fromIndex: number, toIndex: number) => void;
    reorderDock: (ids: string[]) => void;
    persistTabs: (root: string | null) => void;
    restoreTabs: (root: string | null) => void;
    switchWorkspace: (prev: string | null, next: string | null) => void;
  };

export const useRightTabsStore = create<RightTabsState>()((set, get) => {
  const saveHandlers = new Map<string, SaveHandler>();
  let persistReady = false;

  function commit(patch: Partial<RightTabsBase>): void {
    set((state) => {
      const next = { ...state, ...patch };
      return { ...next, ...derive(next) };
    });
  }

  function selectTab(id: string): void {
    commit({ activeId: id });
  }

  function selectPanelTab(id: string): void {
    commit({ panelActiveId: id });
  }

  /** Nearest remaining tab of the same dock after the tab at `removedIdx` went away. */
  function nextDockId(list: RightTab[], removedIdx: number, panel: boolean): string {
    const matches = (tab: RightTab) => isPanelTab(tab) === panel;
    const after = list.slice(removedIdx).find(matches);
    const before = [...list.slice(0, removedIdx)].reverse().find(matches);
    return (after ?? before)?.id ?? "";
  }

  function closeTab(id: string): void {
    const state = get();
    const idx = state.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tab = state.tabs[idx]!;
    // Explicit close kills the pty — workspace switch must NOT call this for terminals.
    if (tab.kind === "terminal" && tab.ptyId) {
      void window.api.terminal.dispose(tab.ptyId);
    }
    if (tab.kind === "browser") {
      clearTabHistory(id);
      void window.api.browser.unreportTab(id);
    }
    const wasPreview = tab.kind === "preview";
    const remaining = state.tabs.filter((_, index) => index !== idx);
    saveHandlers.delete(id);
    let activeId = state.activeId;
    let panelActiveId = state.panelActiveId;
    if (isPanelTab(tab)) {
      if (panelActiveId === id) panelActiveId = nextDockId(remaining, idx, true);
    } else if (activeId === id) {
      activeId = nextDockId(remaining, idx, false);
    }
    const tabs = wasPreview ? refreshPreviewTabLabels(remaining) : remaining;
    commit({ tabs, activeId, panelActiveId });
  }

  function patchTab(id: string, patch: Partial<RightTab>): void {
    const state = get();
    const idx = state.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tab = state.tabs[idx]!;
    // Editing pins the tab so the next open creates / reuses another transient slot
    const pinned =
      tab.kind === "preview" && patch.dirty === true ? { ...tab, ...patch, transient: false } : { ...tab, ...patch };
    const tabs = state.tabs.slice();
    tabs[idx] = pinned;
    commit({
      tabs:
        tab.kind === "preview" && patch.filePath !== undefined
          ? refreshPreviewTabLabels(tabs)
          : tabs,
    });
  }

  /** Auto-update label unless the user locked it via rename. */
  function autoTitleTab(id: string, label: string): void {
    const next = label.trim();
    if (!next) return;
    const state = get();
    const tab = state.tabs.find((t) => t.id === id);
    if (!tab || tab.labelLocked || tab.label === next) return;
    commit({ tabs: state.tabs.map((t) => (t.id === id ? { ...t, label: next } : t)) });
  }

  /** 终端里程序经 OSC 7501 上报的运行状态（pi 会随运行推进上报）。 */
  function setPiStatus(id: string, status: ProgramStatusReport | null): void {
    const state = get();
    const tab = state.tabs.find((t) => t.id === id);
    if (!tab) return;
    commit({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, piStatus: status ?? undefined } : t)),
    });
  }

  function renameTab(id: string, label: string): void {
    const next = label.trim();
    if (!next) return;
    const state = get();
    const tab = state.tabs.find((t) => t.id === id);
    if (!tab || tab.kind === "files") return;
    commit({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, label: next, labelLocked: true } : t)),
    });
  }

  function registerSaveHandler(id: string, handler: SaveHandler): void {
    saveHandlers.set(id, handler);
  }

  function unregisterSaveHandler(id: string): void {
    saveHandlers.delete(id);
  }

  async function saveTab(id: string): Promise<boolean> {
    const handler = saveHandlers.get(id);
    if (!handler) return false;
    return handler();
  }

  function reorderTabs(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    const state = get();
    if (fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= state.tabs.length || toIndex >= state.tabs.length) return;
    const tabs = state.tabs.slice();
    const [item] = tabs.splice(fromIndex, 1);
    if (!item) return;
    tabs.splice(toIndex, 0, item);
    commit({ tabs });
  }

  /** Reorder the right dock from drag UI; panel terminals keep their slots. */
  function reorderDock(ids: string[]): void {
    const state = get();
    const dock = state.dockTabs;
    if (ids.length !== dock.length || new Set(ids).size !== dock.length) return;
    const byId = new Map(dock.map((tab) => [tab.id, tab]));
    const next: RightTab[] = [];
    for (const id of ids) {
      const tab = byId.get(id);
      if (!tab) return;
      next.push(tab);
    }
    let i = 0;
    commit({ tabs: state.tabs.map((tab) => (isPanelTab(tab) ? tab : next[i++]!)) });
  }

  function addPreviewTab(filePath: string): RightTab {
    const state = get();
    const normalized = filePath.replace(/\\/g, "/");
    const existing = state.tabs.find(
      (t) => t.kind === "preview" && t.filePath === normalized,
    );
    if (existing) {
      commit({ activeId: existing.id, tabs: refreshPreviewTabLabels(get().tabs) });
      return existing;
    }

    // Only one unedited (transient) preview tab — reuse it for the next open
    const reusable =
      state.tabs.find(
        (t) =>
          t.id === state.activeId &&
          t.kind === "preview" &&
          t.transient !== false &&
          !t.dirty,
      ) ??
      state.tabs.find(
        (t) => t.kind === "preview" && t.transient !== false && !t.dirty,
      );
    if (reusable) {
      const tabs = state.tabs.map((t) =>
        t.id === reusable.id
          ? {
              ...t,
              filePath: normalized,
              dirty: false,
              missing: false,
              gitCode: undefined,
              transient: true,
            }
          : t,
      );
      const next = refreshPreviewTabLabels(tabs);
      commit({ tabs: next, activeId: reusable.id });
      return next.find((t) => t.id === reusable.id) ?? reusable;
    }

    const label = uniquePreviewTabLabel(
      normalized,
      state.tabs.filter((t) => t.kind === "preview" && t.filePath).map((t) => t.filePath!),
    );
    const tab: RightTab = {
      id: nextTabId("preview"),
      kind: "preview",
      label,
      filePath: normalized,
      dirty: false,
      missing: false,
      transient: true,
    };
    const next = refreshPreviewTabLabels([...state.tabs, tab]);
    commit({ tabs: next, activeId: tab.id });
    return next.find((t) => t.id === tab.id) ?? tab;
  }

  function addTab(
    kind: RightTabKind,
    opts?: { label?: string; filePath?: string; cwd?: string; shellId?: string },
  ): RightTab {
    const state = get();
    const counts = state.tabs.filter((t) => t.kind === kind).length;
    const label = defaultTabLabel(kind, counts, opts);
    if (kind === "running" || kind === "files") {
      const existing = state.tabs.find((t) => t.kind === kind);
      if (existing) {
        commit({ activeId: existing.id });
        return existing;
      }
    }
    if (kind === "preview" && opts?.filePath) {
      return addPreviewTab(opts.filePath);
    }
    const tab: RightTab = {
      id: nextTabId(kind),
      kind,
      label,
      filePath: opts?.filePath,
      dirty: false,
      missing: false,
      transient: kind === "preview",
      cwd: kind === "terminal" ? opts?.cwd : undefined,
      shellId: kind === "terminal" ? opts?.shellId : undefined,
    };
    // Always append at the end — never insert after the active tab / at the front.
    commit({
      tabs: [...state.tabs, tab],
      ...(isPanelTab(tab) ? { panelActiveId: tab.id } : { activeId: tab.id }),
    });
    if (kind === "preview") {
      commit({ tabs: refreshPreviewTabLabels(get().tabs) });
    }
    return tab;
  }

  /** Open (or focus) the singleton diff tab at `path`'s diff. */
  function revealInChanges(path: string): void {
    const normalized = path.replace(/\\/g, "/");
    const label = normalized.split("/").pop() ?? normalized;
    commit({ changesRevealPath: normalized, changesRevealTick: get().changesRevealTick + 1 });
    const existing = get().tabs.find((tab) => tab.kind === "changes");
    if (existing) {
      patchTab(existing.id, { filePath: normalized, label });
      commit({ activeId: existing.id });
      return;
    }
    addTab("changes", { filePath: normalized, label });
  }

  function closeAllPreviewTabs(): void {
    const ids = get().tabs.filter((t) => t.kind === "preview").map((t) => t.id);
    for (const id of ids) closeTab(id);
  }

  async function addPreviewFromPicker(): Promise<void> {
    const picked = await window.api.preview.pickFile();
    if (!picked) return;
    addTab("preview", {
      filePath: picked,
      label: picked.split(/[/\\]/).pop() ?? t.preview,
    });
  }

  async function refreshPreviewGitMeta(): Promise<void> {
    try {
      const status = await window.api.git.status();
      const map = new Map(status.files.map((f) => [f.relativePath, f.code]));
      const state = get();
      let changed = false;
      const tabs = state.tabs.map((tab) => {
        if (tab.kind !== "preview" || !tab.filePath) return tab;
        const code = map.get(tab.filePath);
        if (tab.gitCode === code) return tab;
        changed = true;
        return { ...tab, gitCode: code };
      });
      if (changed) commit({ tabs });
    } catch {
      // ignore
    }
  }

  function persistTabs(root: string | null): void {
    if (!persistReady || !root) return;
    const state = get();
    const payload: PersistedTabs = {
      tabs: state.tabs
        .filter((tab) => tab.kind !== "files")
        .map((tab) => ({
          kind: tab.kind,
          label: tab.label,
          filePath: tab.filePath,
          transient: tab.transient,
          labelLocked: tab.labelLocked,
          // 渲染进程重载后主进程的 pty 仍在运行，靠这个 id 重连才能回放 scrollback。
          // 应用重启后 id 失效，由 TerminalTab 的 isAlive 校验丢弃并新建。
          ptyId: tab.kind === "terminal" ? tab.ptyId : undefined,
          cwd: tab.kind === "terminal" ? tab.cwd : undefined,
          shellId: tab.kind === "terminal" ? tab.shellId : undefined,
          url: tab.kind === "browser" ? tab.url : undefined,
        })),
      activeIndex: Math.max(
        0,
        state.tabs.findIndex((tab) => tab.id === state.activeId),
      ),
    };
    try {
      prefs.setItem(storageKey(root), JSON.stringify(payload));
    } catch {
      // ignore quota
    }
  }

  function restoreTabs(root: string | null): void {
    persistReady = false;
    if (!root) {
      commit({ tabs: defaultTabs(), activeId: "", panelActiveId: "" });
      persistReady = true;
      return;
    }
    let restored: PersistedTabs | null = null;
    try {
      // Prefer v2; fall back to v1 so existing workspaces keep their tabs.
      const raw =
        prefs.getItem(storageKey(root)) ??
        prefs.getItem(`pi-desktop:right-tabs:v1:${root.replace(/\\/g, "/").toLowerCase()}`);
      if (raw) restored = JSON.parse(raw) as PersistedTabs;
    } catch {
      restored = null;
    }
    if (!restored?.tabs?.length) {
      commit({ tabs: defaultTabs(), activeId: "", panelActiveId: "" });
      persistReady = true;
      return;
    }
    const next: RightTab[] = [];
    for (const row of restored.tabs) {
      if (row.kind === "files") continue;
      // Diff views are transient — reopen them from the dock Changes view.
      if (row.kind === "changes") continue;
      if (row.kind === "preview" && !row.filePath) continue;
      const url =
        row.kind === "browser" && typeof row.url === "string" && row.url.trim()
          ? row.url.trim()
          : undefined;
      const ptyId =
        row.kind === "terminal" && typeof row.ptyId === "string" && row.ptyId.trim()
          ? row.ptyId
          : undefined;
      next.push({
        id: nextTabId(row.kind),
        kind: row.kind,
        label:
          row.label ||
          (row.kind === "running" ? t.runningTab : row.kind),
        filePath: row.filePath,
        dirty: false,
        missing: false,
        labelLocked: row.labelLocked === true,
        transient: row.kind === "preview" ? row.transient !== false : undefined,
        cwd: row.kind === "terminal" ? row.cwd || root : undefined,
        shellId: row.kind === "terminal" ? row.shellId : undefined,
        ptyId,
        url,
      });
    }
    const tabs = refreshPreviewTabLabels(syncLocalizedLabels(next));
    const preferredIdx = Math.min(Math.max(0, restored.activeIndex), tabs.length - 1);
    const preferredId = tabs[preferredIdx]?.id;
    const dock = tabs.filter((tab) => !isPanelTab(tab));
    const activeId =
      preferredId && dock.some((tab) => tab.id === preferredId)
        ? preferredId
        : (dock[0]?.id ?? "");
    const restoredPanel = tabs.filter(isPanelTab);
    const panelActiveId = restoredPanel[restoredPanel.length - 1]?.id ?? "";
    commit({ tabs, activeId, panelActiveId });
    persistReady = true;
  }

  /**
   * Switch workspace tab set: park previous (keep pty alive), restore parked or disk.
   */
  function switchWorkspace(prev: string | null, next: string | null): void {
    if (prev) {
      const state = get();
      const key = normalizeRoot(prev);
      parkedByRoot.set(key, {
        tabs: cloneTabs(state.tabs),
        activeId: state.activeId,
        panelActiveId: state.panelActiveId,
      });
      persistTabs(prev);
    }

    persistReady = false;
    if (!next) {
      commit({ tabs: defaultTabs(), activeId: "", panelActiveId: "" });
      persistReady = true;
      return;
    }

    const parked = parkedByRoot.get(normalizeRoot(next));
    if (parked?.tabs?.length) {
      const tabs = syncLocalizedLabels(cloneTabs(parked.tabs));
      const dock = tabs.filter((tab) => !isPanelTab(tab));
      const dockActive = dock.some((tab) => tab.id === parked.activeId);
      const activeId = dockActive ? parked.activeId : (dock[0]?.id ?? "");
      const parkedPanel = tabs.filter(isPanelTab);
      const panelStillThere = parkedPanel.some((tab) => tab.id === parked.panelActiveId);
      const panelActiveId = panelStillThere
        ? parked.panelActiveId
        : (parkedPanel[parkedPanel.length - 1]?.id ?? "");
      commit({ tabs: refreshPreviewTabLabels(tabs), activeId, panelActiveId });
      persistReady = true;
      return;
    }

    restoreTabs(next);
  }

  // 切换界面语言后，固定标签（运行/文件/浏览器/终端）就地换成新语言。
  subscribeLocale(() => {
    commit({ tabs: syncLocalizedLabels(get().tabs) });
  });

  const base: RightTabsBase = {
    tabs: defaultTabs(),
    activeId: "changes-0",
    panelActiveId: "",
    changesRevealPath: "",
    changesRevealTick: 0,
  };

  return {
    ...base,
    ...derive(base),
    selectTab,
    selectPanelTab,
    closeTab,
    closeAllPreviewTabs,
    patchTab,
    autoTitleTab,
    setPiStatus,
    renameTab,
    addTab,
    revealInChanges,
    addPreviewFromPicker,
    registerSaveHandler,
    unregisterSaveHandler,
    saveTab,
    refreshPreviewGitMeta,
    reorderTabs,
    reorderDock,
    persistTabs,
    restoreTabs,
    switchWorkspace,
  };
});

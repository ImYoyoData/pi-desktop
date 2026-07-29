import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { t } from "@renderer/i18n";
import { clearTabHistory } from "@renderer/stores/browser-library";
import { localizedTabLabel } from "@renderer/utils/right-tab-labels";
import { pinRunningFirst } from "@renderer/utils/right-tabs-running";

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
};

/** In-memory park so terminal PTYs stay alive across workspace switches. */
const parkedByRoot = new Map<string, ParkedWorkspace>();

function cloneTabs(list: RightTab[]): RightTab[] {
  return list.map((tab) => ({ ...tab }));
}

function defaultRunningAndChanges(): RightTab[] {
  return [
    { id: "running-0", kind: "running", label: t.runningTab },
    { id: "changes-0", kind: "changes", label: t.changesTab },
  ];
}

/** Re-apply active-locale labels after restore / language switch reload. */
function syncLocalizedLabels(list: RightTab[]): void {
  for (const tab of list) {
    const next = localizedTabLabel(tab);
    if (tab.label !== next) tab.label = next;
  }
}

export const useRightTabsStore = defineStore("rightTabs", () => {
  const tabs = ref<RightTab[]>(defaultRunningAndChanges());
  const activeId = ref("changes-0");
  const saveHandlers = new Map<string, SaveHandler>();
  let persistReady = false;

  const activeTab = computed(() => tabs.value.find((t) => t.id === activeId.value) ?? null);

  function ensureRunningTabPinned(): void {
    const existing = tabs.value.find((t) => t.kind === "running");
    if (!existing) {
      const tab: RightTab = {
        id: nextTabId("running"),
        kind: "running",
        label: t.runningTab,
      };
      tabs.value = [tab, ...tabs.value.filter((t) => t.kind !== "running")];
      syncLocalizedLabels(tabs.value);
      return;
    }
    tabs.value = pinRunningFirst(tabs.value);
    syncLocalizedLabels(tabs.value);
  }

  function selectTab(id: string): void {
    activeId.value = id;
  }

  function closeTab(id: string): void {
    const idx = tabs.value.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tab = tabs.value[idx]!;
    if (tab.kind === "running") return;
    // Explicit close kills the pty — workspace switch must NOT call this for terminals.
    if (tab.kind === "terminal" && tab.ptyId) {
      void window.api.terminal.dispose(tab.ptyId);
    }
    if (tab.kind === "browser") {
      clearTabHistory(id);
      void window.api.browser.unreportTab(id);
    }
    tabs.value.splice(idx, 1);
    saveHandlers.delete(id);
    if (activeId.value === id) {
      const next = tabs.value[idx] ?? tabs.value[idx - 1] ?? null;
      activeId.value = next?.id ?? "";
    }
  }

  function patchTab(id: string, patch: Partial<RightTab>): void {
    const tab = tabs.value.find((t) => t.id === id);
    if (!tab) return;
    Object.assign(tab, patch);
    // Editing pins the tab so the next open creates / reuses another transient slot
    if (tab.kind === "preview" && patch.dirty === true) {
      tab.transient = false;
    }
  }

  /** Auto-update label unless the user locked it via rename. */
  function autoTitleTab(id: string, label: string): void {
    const tab = tabs.value.find((t) => t.id === id);
    if (!tab || tab.labelLocked) return;
    const next = label.trim();
    if (!next || tab.label === next) return;
    tab.label = next;
  }

  function renameTab(id: string, label: string): void {
    const tab = tabs.value.find((t) => t.id === id);
    // Fixed singleton tabs keep their i18n labels
    if (!tab || tab.kind === "running" || tab.kind === "changes" || tab.kind === "files") {
      return;
    }
    const next = label.trim();
    if (!next) return;
    tab.label = next;
    tab.labelLocked = true;
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
    if (fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= tabs.value.length || toIndex >= tabs.value.length) return;
    const [item] = tabs.value.splice(fromIndex, 1);
    if (!item) return;
    tabs.value.splice(toIndex, 0, item);
    ensureRunningTabPinned();
  }

  /** Reorder by full id list from drag UI (preferred over index math). */
  function reorderByIds(ids: string[]): void {
    if (ids.length !== tabs.value.length) return;
    const byId = new Map(tabs.value.map((tab) => [tab.id, tab]));
    const next: RightTab[] = [];
    for (const id of ids) {
      const tab = byId.get(id);
      if (!tab) return;
      next.push(tab);
    }
    if (next.length !== tabs.value.length) return;
    tabs.value = next;
    ensureRunningTabPinned();
  }

  function addTab(kind: RightTabKind, opts?: { label?: string; filePath?: string; cwd?: string }): RightTab {
    const counts = tabs.value.filter((t) => t.kind === kind).length;
    let label = opts?.label;
    if (!label) {
      switch (kind) {
        case "running":
          label = t.runningTab;
          break;
        case "changes":
          label = t.changesTab;
          break;
        case "files":
          label = t.filesTab;
          break;
        case "browser":
          label = counts === 0 ? t.browser : t.browserLabel(counts + 1);
          break;
        case "terminal":
          label = counts === 0 ? t.terminal : t.terminalLabel(counts + 1);
          break;
        case "preview":
          label = opts?.filePath?.split(/[/\\]/).pop() ?? t.preview;
          break;
        default: {
          const _never: never = kind;
          label = String(_never);
        }
      }
    }
    if (kind === "running" || kind === "changes" || kind === "files") {
      const existing = tabs.value.find((t) => t.kind === kind);
      if (existing) {
        activeId.value = existing.id;
        return existing;
      }
    }
    if (kind === "preview" && opts?.filePath) {
      const normalized = opts.filePath.replace(/\\/g, "/");
      const fileLabel = opts.label ?? normalized.split(/[/\\]/).pop() ?? t.preview;
      const existing = tabs.value.find(
        (t) => t.kind === "preview" && t.filePath === normalized,
      );
      if (existing) {
        activeId.value = existing.id;
        return existing;
      }

      // Only one unedited (transient) preview tab — reuse it for the next open
      const reusable =
        tabs.value.find(
          (t) =>
            t.id === activeId.value &&
            t.kind === "preview" &&
            t.transient !== false &&
            !t.dirty,
        ) ??
        tabs.value.find(
          (t) => t.kind === "preview" && t.transient !== false && !t.dirty,
        );
      if (reusable) {
        Object.assign(reusable, {
          filePath: normalized,
          label: fileLabel,
          dirty: false,
          missing: false,
          gitCode: undefined,
          transient: true,
        });
        activeId.value = reusable.id;
        return reusable;
      }

      opts = { ...opts, filePath: normalized };
      label = fileLabel;
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
    };
    // Always append at the end — never insert after the active tab / at the front.
    tabs.value = [...tabs.value, tab];
    if (kind === "running") ensureRunningTabPinned();
    activeId.value = tab.id;
    return tab;
  }

  function closeAllPreviewTabs(): void {
    const ids = tabs.value.filter((t) => t.kind === "preview").map((t) => t.id);
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
      for (const tab of tabs.value) {
        if (tab.kind !== "preview" || !tab.filePath) continue;
        const code = map.get(tab.filePath);
        if (tab.gitCode !== code) tab.gitCode = code;
      }
    } catch {
      // ignore
    }
  }

  function persistTabs(root: string | null): void {
    if (!persistReady || !root) return;
    const payload: PersistedTabs = {
      tabs: tabs.value
        .filter((tab) => tab.kind !== "files")
        .map((tab) => ({
          kind: tab.kind,
          label: tab.label,
          filePath: tab.filePath,
          transient: tab.transient,
          labelLocked: tab.labelLocked,
          // ptyId is session-only — never write to localStorage
          cwd: tab.kind === "terminal" ? tab.cwd : undefined,
          url: tab.kind === "browser" ? tab.url : undefined,
        })),
      activeIndex: Math.max(
        0,
        tabs.value.findIndex((tab) => tab.id === activeId.value),
      ),
    };
    try {
      localStorage.setItem(storageKey(root), JSON.stringify(payload));
    } catch {
      // ignore quota
    }
  }

  function restoreTabs(root: string | null): void {
    persistReady = false;
    if (!root) {
      tabs.value = defaultRunningAndChanges();
      activeId.value = "changes-0";
      ensureRunningTabPinned();
      persistReady = true;
      return;
    }
    let restored: PersistedTabs | null = null;
    try {
      // Prefer v2; fall back to v1 so existing workspaces keep their tabs.
      const raw =
        localStorage.getItem(storageKey(root)) ??
        localStorage.getItem(`pi-desktop:right-tabs:v1:${root.replace(/\\/g, "/").toLowerCase()}`);
      if (raw) restored = JSON.parse(raw) as PersistedTabs;
    } catch {
      restored = null;
    }
    if (!restored?.tabs?.length) {
      tabs.value = [
        { id: nextTabId("running"), kind: "running", label: t.runningTab },
        { id: nextTabId("changes"), kind: "changes", label: t.changesTab },
      ];
      activeId.value = tabs.value.find((tab) => tab.kind === "changes")?.id ?? tabs.value[0]!.id;
      ensureRunningTabPinned();
      persistReady = true;
      return;
    }
    const next: RightTab[] = [];
    for (const row of restored.tabs) {
      if (row.kind === "files") continue;
      if (row.kind === "preview" && !row.filePath) continue;
      const url =
        row.kind === "browser" && typeof row.url === "string" && row.url.trim()
          ? row.url.trim()
          : undefined;
      next.push({
        id: nextTabId(row.kind),
        kind: row.kind,
        label:
          row.label ||
          (row.kind === "running"
            ? t.runningTab
            : row.kind === "changes"
              ? t.changesTab
              : row.kind),
        filePath: row.filePath,
        dirty: false,
        missing: false,
        labelLocked: row.labelLocked === true,
        transient: row.kind === "preview" ? row.transient !== false : undefined,
        cwd: row.kind === "terminal" ? row.cwd || root : undefined,
        url,
      });
    }
    if (!next.some((tab) => tab.kind === "changes")) {
      next.unshift({ id: nextTabId("changes"), kind: "changes", label: t.changesTab });
    }
    syncLocalizedLabels(next);
    tabs.value = next;
    const preferredIdx = Math.min(Math.max(0, restored.activeIndex), next.length - 1);
    const preferredId = next[preferredIdx]?.id;
    ensureRunningTabPinned();
    const stillThere = preferredId
      ? tabs.value.some((tab) => tab.id === preferredId)
      : false;
    activeId.value = stillThere
      ? preferredId!
      : (tabs.value.find((tab) => tab.kind === "changes")?.id ?? tabs.value[0]!.id);
    persistReady = true;
  }

  /**
   * Switch workspace tab set: park previous (keep pty alive), restore parked or disk.
   */
  function switchWorkspace(prev: string | null, next: string | null): void {
    if (prev) {
      const key = normalizeRoot(prev);
      parkedByRoot.set(key, {
        tabs: cloneTabs(tabs.value),
        activeId: activeId.value,
      });
      persistTabs(prev);
    }

    persistReady = false;
    if (!next) {
      tabs.value = defaultRunningAndChanges();
      activeId.value = "changes-0";
      ensureRunningTabPinned();
      persistReady = true;
      return;
    }

    const parked = parkedByRoot.get(normalizeRoot(next));
    if (parked?.tabs?.length) {
      tabs.value = cloneTabs(parked.tabs);
      ensureRunningTabPinned();
      syncLocalizedLabels(tabs.value);
      const stillThere = tabs.value.some((tab) => tab.id === parked.activeId);
      activeId.value = stillThere ? parked.activeId : (tabs.value[0]?.id ?? "");
      persistReady = true;
      return;
    }

    restoreTabs(next);
  }

  return {
    tabs,
    activeId,
    activeTab,
    selectTab,
    closeTab,
    closeAllPreviewTabs,
    patchTab,
    autoTitleTab,
    renameTab,
    addTab,
    addPreviewFromPicker,
    registerSaveHandler,
    unregisterSaveHandler,
    saveTab,
    refreshPreviewGitMeta,
    reorderTabs,
    reorderByIds,
    persistTabs,
    restoreTabs,
    switchWorkspace,
  };
});

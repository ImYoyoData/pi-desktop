import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { t } from "@renderer/i18n";

export type RightTabKind = "changes" | "files" | "browser" | "terminal" | "preview";

export type RightTab = {
  id: string;
  kind: RightTabKind;
  label: string;
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
  }>;
  activeIndex: number;
};

const TABS_STORAGE_PREFIX = "pi-desktop:right-tabs:v1:";

function storageKey(root: string): string {
  return `${TABS_STORAGE_PREFIX}${root.replace(/\\/g, "/").toLowerCase()}`;
}

export const useRightTabsStore = defineStore("rightTabs", () => {
  const tabs = ref<RightTab[]>([
    { id: "changes-0", kind: "changes", label: t.changesTab },
  ]);
  const activeId = ref("changes-0");
  const saveHandlers = new Map<string, SaveHandler>();
  let persistReady = false;

  const activeTab = computed(() => tabs.value.find((t) => t.id === activeId.value) ?? null);

  function selectTab(id: string): void {
    activeId.value = id;
  }

  function closeTab(id: string): void {
    const idx = tabs.value.findIndex((t) => t.id === id);
    if (idx < 0) return;
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
  }

  function addTab(kind: RightTabKind, opts?: { label?: string; filePath?: string }): RightTab {
    const counts = tabs.value.filter((t) => t.kind === kind).length;
    let label = opts?.label;
    if (!label) {
      switch (kind) {
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
    if (kind === "changes" || kind === "files") {
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
    };
    tabs.value.push(tab);
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
      tabs.value = [{ id: "changes-0", kind: "changes", label: t.changesTab }];
      activeId.value = "changes-0";
      persistReady = true;
      return;
    }
    let restored: PersistedTabs | null = null;
    try {
      const raw = localStorage.getItem(storageKey(root));
      if (raw) restored = JSON.parse(raw) as PersistedTabs;
    } catch {
      restored = null;
    }
    if (!restored?.tabs?.length) {
      tabs.value = [{ id: nextTabId("changes"), kind: "changes", label: t.changesTab }];
      activeId.value = tabs.value[0]!.id;
      persistReady = true;
      return;
    }
    const next: RightTab[] = [];
    for (const row of restored.tabs) {
      if (row.kind === "files") continue;
      if (row.kind === "preview" && !row.filePath) continue;
      next.push({
        id: nextTabId(row.kind),
        kind: row.kind,
        label: row.label || (row.kind === "changes" ? t.changesTab : row.kind),
        filePath: row.filePath,
        dirty: false,
        missing: false,
        transient: row.kind === "preview" ? row.transient !== false : undefined,
      });
    }
    if (!next.some((tab) => tab.kind === "changes")) {
      next.unshift({ id: nextTabId("changes"), kind: "changes", label: t.changesTab });
    }
    tabs.value = next;
    const idx = Math.min(Math.max(0, restored.activeIndex), next.length - 1);
    activeId.value = next[idx]?.id ?? next[0]!.id;
    persistReady = true;
  }

  return {
    tabs,
    activeId,
    activeTab,
    selectTab,
    closeTab,
    closeAllPreviewTabs,
    patchTab,
    addTab,
    addPreviewFromPicker,
    registerSaveHandler,
    unregisterSaveHandler,
    saveTab,
    refreshPreviewGitMeta,
    reorderTabs,
    persistTabs,
    restoreTabs,
  };
});

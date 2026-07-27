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

export const useRightTabsStore = defineStore("rightTabs", () => {
  const tabs = ref<RightTab[]>([
    { id: "changes-0", kind: "changes", label: t.changesTab },
  ]);
  const activeId = ref("changes-0");
  const saveHandlers = new Map<string, SaveHandler>();

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
  };
});

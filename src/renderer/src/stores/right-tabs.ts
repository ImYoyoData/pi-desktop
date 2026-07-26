import { defineStore } from "pinia";
import { computed, ref } from "vue";

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
};

let tabSeq = 0;
function nextTabId(kind: RightTabKind): string {
  tabSeq += 1;
  return `${kind}-${tabSeq}`;
}

type SaveHandler = () => Promise<boolean>;

export const useRightTabsStore = defineStore("rightTabs", () => {
  const tabs = ref<RightTab[]>([
    { id: "changes-0", kind: "changes", label: "更改" },
    { id: "browser-0", kind: "browser", label: "浏览器" },
    { id: "terminal-0", kind: "terminal", label: "终端" },
  ]);
  const activeId = ref("browser-0");
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
          label = "更改";
          break;
        case "files":
          label = "文件";
          break;
        case "browser":
          label = counts === 0 ? "浏览器" : `浏览器 ${counts + 1}`;
          break;
        case "terminal":
          label = counts === 0 ? "终端" : `终端 ${counts + 1}`;
          break;
        case "preview":
          label = opts?.filePath?.split(/[/\\]/).pop() ?? "预览";
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
      const existing = tabs.value.find(
        (t) => t.kind === "preview" && t.filePath === normalized,
      );
      if (existing) {
        activeId.value = existing.id;
        return existing;
      }
      opts = { ...opts, filePath: normalized };
    }
    const tab: RightTab = {
      id: nextTabId(kind),
      kind,
      label,
      filePath: opts?.filePath,
      dirty: false,
      missing: false,
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
      label: picked.split(/[/\\]/).pop() ?? "预览",
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

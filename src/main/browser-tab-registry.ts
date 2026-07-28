import type { BrowserTabInfo } from "../shared/browser-automation";

const tabs = new Map<string, BrowserTabInfo>();

function normalizeRoot(root: string | null | undefined): string | null {
  if (!root) return null;
  return root.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export type BrowserTabRegistry = {
  upsert: (info: BrowserTabInfo) => void;
  remove: (tabId: string) => void;
  list: (workspaceRoot?: string | null) => BrowserTabInfo[];
  get: (tabId: string) => BrowserTabInfo | null;
  resolveTarget: (opts: {
    tabId?: string | null;
    workspaceRoot?: string | null;
  }) => BrowserTabInfo | null;
};

export function createBrowserTabRegistry(): BrowserTabRegistry {
  function upsert(info: BrowserTabInfo): void {
    tabs.set(info.tabId, {
      ...info,
      workspaceRoot: normalizeRoot(info.workspaceRoot),
    });
  }

  function remove(tabId: string): void {
    tabs.delete(tabId);
  }

  function list(workspaceRoot?: string | null): BrowserTabInfo[] {
    const key = normalizeRoot(workspaceRoot);
    const rows = [...tabs.values()];
    if (!key) return rows.map((r) => ({ ...r }));
    return rows.filter((r) => r.workspaceRoot === key).map((r) => ({ ...r }));
  }

  function get(tabId: string): BrowserTabInfo | null {
    const row = tabs.get(tabId);
    return row ? { ...row } : null;
  }

  function resolveTarget(opts: {
    tabId?: string | null;
    workspaceRoot?: string | null;
  }): BrowserTabInfo | null {
    if (opts.tabId) {
      const hit = get(opts.tabId);
      if (hit) return hit;
    }
    const rows = list(opts.workspaceRoot);
    const visible = rows.find((r) => r.visible);
    if (visible) return visible;
    return rows[0] ?? null;
  }

  return { upsert, remove, list, get, resolveTarget };
}

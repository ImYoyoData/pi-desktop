import { create } from "zustand";

type BrowserNavState = {
  pendingUrl: string | null;
  pendingTabId: string | null;
  /** Bumps even when the same URL is requested twice. */
  seq: number;
  requestNavigate: (url: string, tabId: string) => void;
  takePending: (tabId: string) => string | null;
};

/**
 * Pending in-app browser navigations.
 * CustomEvents are unsafe: a newly created BrowserTab mounts after the click
 * handler returns, so the event is missed (and older tabs steal it).
 */
export const useBrowserNavStore = create<BrowserNavState>()((set, get) => {
  function requestNavigate(url: string, tabId: string): void {
    set((state) => ({
      pendingUrl: url,
      pendingTabId: tabId,
      seq: state.seq + 1,
    }));
  }

  /** Returns the URL if this tab should consume the current pending request. */
  function takePending(tabId: string): string | null {
    const state = get();
    if (!state.pendingUrl || state.pendingTabId !== tabId) return null;
    const url = state.pendingUrl;
    set({ pendingUrl: null, pendingTabId: null });
    return url;
  }

  return {
    pendingUrl: null,
    pendingTabId: null,
    seq: 0,
    requestNavigate,
    takePending,
  };
});

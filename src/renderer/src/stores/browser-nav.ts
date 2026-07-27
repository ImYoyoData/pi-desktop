import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * Pending in-app browser navigations.
 * CustomEvents are unsafe: a newly created BrowserTab mounts after the click
 * handler returns, so the event is missed (and older tabs steal it).
 */
export const useBrowserNavStore = defineStore("browserNav", () => {
  const pendingUrl = ref<string | null>(null);
  const pendingTabId = ref<string | null>(null);
  /** Bumps even when the same URL is requested twice. */
  const seq = ref(0);

  function requestNavigate(url: string, tabId: string): void {
    pendingUrl.value = url;
    pendingTabId.value = tabId;
    seq.value += 1;
  }

  /** Returns the URL if this tab should consume the current pending request. */
  function takePending(tabId: string): string | null {
    if (!pendingUrl.value || pendingTabId.value !== tabId) return null;
    const url = pendingUrl.value;
    pendingUrl.value = null;
    pendingTabId.value = null;
    return url;
  }

  return {
    pendingUrl,
    pendingTabId,
    seq,
    requestNavigate,
    takePending,
  };
});

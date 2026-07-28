import { t } from "@renderer/i18n";
import { useBrowserNavStore } from "@renderer/stores/browser-nav";
import { useLayoutStore } from "@renderer/stores/layout";
import { useRightTabsStore } from "@renderer/stores/right-tabs";

/** Minimal dialog surface used for Ctrl/Cmd+click link confirmations. */
export type LinkConfirmDialog = {
  warning: (options: {
    title: string;
    content: string;
    positiveText: string;
    negativeText: string;
    onPositiveClick?: () => void;
    onNegativeClick?: () => void;
  }) => unknown;
};

/** Normalize link text from terminals / markdown into an http(s) URL. */
export function normalizeHttpUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
  return null;
}

/** Open URL in a new built-in browser tab (never overwrite an existing one). */
export function openInBuiltinBrowser(url: string): void {
  const rightTabs = useRightTabsStore();
  const layout = useLayoutStore();
  const browserNav = useBrowserNavStore();
  const tab = rightTabs.addTab("browser");
  rightTabs.patchTab(tab.id, { url });
  browserNav.requestNavigate(url, tab.id);
  if (layout.rightCollapsed) layout.toggleRightCollapsed();
}

/**
 * Default click → built-in browser.
 * Ctrl/Cmd+click → confirm: system browser (positive) or built-in (negative).
 */
export function handleAppLinkClick(
  event: MouseEvent,
  rawUrl: string,
  dialog: LinkConfirmDialog,
): void {
  const url = normalizeHttpUrl(rawUrl);
  if (!url) return;

  if (event.ctrlKey || event.metaKey) {
    dialog.warning({
      title: t.openExternalBrowser,
      content: t.openExternalBrowserConfirm(url),
      positiveText: t.openInSystemBrowser,
      negativeText: t.openInBuiltinBrowser,
      onPositiveClick: () => {
        void window.api.browser.openExternal(url);
      },
      onNegativeClick: () => {
        openInBuiltinBrowser(url);
      },
    });
    return;
  }

  openInBuiltinBrowser(url);
}

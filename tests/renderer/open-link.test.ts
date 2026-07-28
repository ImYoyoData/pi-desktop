import { describe, expect, it, vi, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  handleAppLinkClick,
  normalizeHttpUrl,
  openInBuiltinBrowser,
  type LinkConfirmDialog,
} from "../../src/renderer/src/utils/open-link";
import { useRightTabsStore } from "../../src/renderer/src/stores/right-tabs";
import { useLayoutStore } from "../../src/renderer/src/stores/layout";
import { useBrowserNavStore } from "../../src/renderer/src/stores/browser-nav";

describe("normalizeHttpUrl", () => {
  it("accepts http(s) and www", () => {
    expect(normalizeHttpUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(normalizeHttpUrl("http://example.com")).toBe("http://example.com");
    expect(normalizeHttpUrl("www.example.com/x")).toBe("https://www.example.com/x");
  });

  it("rejects non-http schemes", () => {
    expect(normalizeHttpUrl("ftp://x")).toBeNull();
    expect(normalizeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeHttpUrl("")).toBeNull();
  });
});

describe("handleAppLinkClick", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("window", {
      api: {
        browser: {
          openExternal: vi.fn(),
        },
      },
    });
  });

  it("opens built-in browser on plain click", () => {
    const layout = useLayoutStore();
    layout.rightCollapsed = true;
    const dialog: LinkConfirmDialog = { warning: vi.fn() };

    handleAppLinkClick(
      { ctrlKey: false, metaKey: false } as MouseEvent,
      "https://pi.dev/docs",
      dialog,
    );

    expect(dialog.warning).not.toHaveBeenCalled();
    const tabs = useRightTabsStore();
    const browser = tabs.tabs.find((t) => t.kind === "browser");
    expect(browser).toBeTruthy();
    expect(useBrowserNavStore().pendingUrl).toBe("https://pi.dev/docs");
    expect(layout.rightCollapsed).toBe(false);
  });

  it("Ctrl+click shows dialog with external and built-in actions", () => {
    const dialog: LinkConfirmDialog = {
      warning: vi.fn((opts) => {
        opts.onNegativeClick?.();
      }),
    };

    handleAppLinkClick(
      { ctrlKey: true, metaKey: false } as MouseEvent,
      "https://example.com",
      dialog,
    );

    expect(dialog.warning).toHaveBeenCalledOnce();
    const call = vi.mocked(dialog.warning).mock.calls[0]![0];
    expect(call.positiveText).toBeTruthy();
    expect(call.negativeText).toBeTruthy();

    const browser = useRightTabsStore().tabs.find((t) => t.kind === "browser");
    expect(browser).toBeTruthy();

    // External path
    call.onPositiveClick?.();
    expect(window.api.browser.openExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("openInBuiltinBrowser always creates a new tab", () => {
    openInBuiltinBrowser("https://a.example");
    openInBuiltinBrowser("https://b.example");
    const browsers = useRightTabsStore().tabs.filter((t) => t.kind === "browser");
    expect(browsers.length).toBe(2);
  });
});

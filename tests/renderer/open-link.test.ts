import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  handleAppLinkClick,
  normalizeHttpUrl,
  openInBuiltinBrowser,
  type LinkConfirmDialog,
} from "../../src/renderer/src/utils/open-link";

const { rightTabsStore, layoutStore, browserNavStore } = vi.hoisted(() => {
  type MockTab = { id: string; kind: string; label: string; url?: string };
  type MockStore<T> = (() => T) & {
    getState: () => T;
    setState: (patch: Partial<T>) => void;
  };

  function createMockStore<T extends object>(createState: () => T): MockStore<T> {
    const state = createState();
    const store = (() => state) as MockStore<T>;
    store.getState = () => state;
    store.setState = (patch) => {
      Object.assign(state, patch);
    };
    return store;
  }

  const rightTabsStore = createMockStore(() => {
    const state: {
      tabs: MockTab[];
      addTab: (kind: string) => MockTab;
      patchTab: (id: string, patch: Partial<MockTab>) => void;
    } = {
      tabs: [],
      addTab: (kind) => {
        const tab: MockTab = {
          id: `${kind}-${state.tabs.length + 1}`,
          kind,
          label: kind,
        };
        state.tabs.push(tab);
        return tab;
      },
      patchTab: (id, patch) => {
        const tab = state.tabs.find((t) => t.id === id);
        if (tab) Object.assign(tab, patch);
      },
    };
    return state;
  });

  const layoutStore = createMockStore(() => {
    const state: {
      rightCollapsed: boolean;
      toggleRightCollapsed: () => void;
    } = {
      rightCollapsed: true,
      toggleRightCollapsed: () => {
        state.rightCollapsed = !state.rightCollapsed;
      },
    };
    return state;
  });

  const browserNavStore = createMockStore(() => {
    const state: {
      pendingUrl: string | null;
      pendingTabId: string | null;
      seq: number;
      requestNavigate: (url: string, tabId: string) => void;
    } = {
      pendingUrl: null,
      pendingTabId: null,
      seq: 0,
      requestNavigate: (url, tabId) => {
        state.pendingUrl = url;
        state.pendingTabId = tabId;
        state.seq += 1;
      },
    };
    return state;
  });

  return { rightTabsStore, layoutStore, browserNavStore };
});

vi.mock("../../src/renderer/src/stores/right-tabs", () => ({
  useRightTabsStore: rightTabsStore,
}));

vi.mock("../../src/renderer/src/stores/layout", () => ({
  useLayoutStore: layoutStore,
}));

vi.mock("../../src/renderer/src/stores/browser-nav", () => ({
  useBrowserNavStore: browserNavStore,
}));

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
    rightTabsStore.setState({ tabs: [] });
    layoutStore.setState({ rightCollapsed: true });
    browserNavStore.setState({ pendingUrl: null, pendingTabId: null, seq: 0 });
    vi.stubGlobal("window", {
      api: {
        browser: {
          openExternal: vi.fn(),
        },
      },
    });
  });

  it("opens built-in browser on plain click", () => {
    layoutStore.setState({ rightCollapsed: true });
    const dialog: LinkConfirmDialog = { warning: vi.fn() };

    handleAppLinkClick(
      { ctrlKey: false, metaKey: false } as MouseEvent,
      "https://pi.dev/docs",
      dialog,
    );

    expect(dialog.warning).not.toHaveBeenCalled();
    const tabs = rightTabsStore.getState();
    const browser = tabs.tabs.find((t) => t.kind === "browser");
    expect(browser).toBeTruthy();
    expect(browserNavStore.getState().pendingUrl).toBe("https://pi.dev/docs");
    expect(layoutStore.getState().rightCollapsed).toBe(false);
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

    const browser = rightTabsStore
      .getState()
      .tabs.find((t) => t.kind === "browser");
    expect(browser).toBeTruthy();

    // External path
    call.onPositiveClick?.();
    expect(window.api.browser.openExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("openInBuiltinBrowser always creates a new tab", () => {
    openInBuiltinBrowser("https://a.example");
    openInBuiltinBrowser("https://b.example");
    const browsers = rightTabsStore
      .getState()
      .tabs.filter((t) => t.kind === "browser");
    expect(browsers.length).toBe(2);
  });
});

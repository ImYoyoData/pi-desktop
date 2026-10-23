import { beforeEach, describe, expect, it } from "vitest";
import { useBrowserNavStore } from "../../src/renderer/src/stores/browser-nav";

describe("browser-nav store", () => {
  beforeEach(() => {
    useBrowserNavStore.setState(useBrowserNavStore.getInitialState(), true);
  });

  it("delivers pending url only to the target tab", () => {
    const nav = useBrowserNavStore.getState();
    nav.requestNavigate("https://example.com/a", "browser-1");
    expect(nav.takePending("browser-2")).toBeNull();
    expect(nav.takePending("browser-1")).toBe("https://example.com/a");
    expect(nav.takePending("browser-1")).toBeNull();
  });

  it("bumps seq when the same url is requested again", () => {
    const nav = useBrowserNavStore.getState();
    nav.requestNavigate("https://example.com", "browser-1");
    const first = useBrowserNavStore.getState().seq;
    nav.requestNavigate("https://example.com", "browser-1");
    expect(useBrowserNavStore.getState().seq).toBe(first + 1);
  });
});

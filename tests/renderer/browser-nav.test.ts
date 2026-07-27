import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useBrowserNavStore } from "../../src/renderer/src/stores/browser-nav";

describe("browser-nav store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("delivers pending url only to the target tab", () => {
    const nav = useBrowserNavStore();
    nav.requestNavigate("https://example.com/a", "browser-1");
    expect(nav.takePending("browser-2")).toBeNull();
    expect(nav.takePending("browser-1")).toBe("https://example.com/a");
    expect(nav.takePending("browser-1")).toBeNull();
  });

  it("bumps seq when the same url is requested again", () => {
    const nav = useBrowserNavStore();
    nav.requestNavigate("https://example.com", "browser-1");
    const first = nav.seq;
    nav.requestNavigate("https://example.com", "browser-1");
    expect(nav.seq).toBe(first + 1);
  });
});

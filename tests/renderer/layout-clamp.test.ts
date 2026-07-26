import { beforeEach, describe, expect, it } from "vitest";
import {
  clampPanelWidth,
  clampPanePercent,
  DEFAULT_LAYOUT,
  readLayout,
  writeLayout,
} from "../../src/renderer/src/stores/layout-utils";

function installMemoryLocalStorage(): void {
  const store = new Map<string, string>();
  const memory = {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: memory,
    configurable: true,
  });
}

installMemoryLocalStorage();

describe("clampPanelWidth", () => {
  it("keeps values in range", () => {
    expect(clampPanelWidth(240)).toBe(240);
  });

  it("clamps below min", () => {
    expect(clampPanelWidth(100)).toBe(180);
  });

  it("clamps above max", () => {
    expect(clampPanelWidth(800)).toBe(560);
  });

  it("accepts custom bounds", () => {
    expect(clampPanelWidth(50, 60, 120)).toBe(60);
    expect(clampPanelWidth(200, 60, 120)).toBe(120);
  });
});

describe("clampPanePercent", () => {
  it("defaults to 12–70", () => {
    expect(clampPanePercent(20)).toBe(20);
    expect(clampPanePercent(10)).toBe(12);
    expect(clampPanePercent(80)).toBe(70);
  });
});

describe("layout v4 defaults", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to 20/30/50", () => {
    expect(DEFAULT_LAYOUT.leftSize).toBe(20);
    expect(DEFAULT_LAYOUT.centerSize).toBe(30);
    expect(DEFAULT_LAYOUT.rightSize).toBe(50);
  });

  it("reads defaults when empty", () => {
    const key = "layout-test-empty-ws";
    expect(readLayout(key)).toEqual(DEFAULT_LAYOUT);
  });

  it("round-trips percent layout", () => {
    const key = "layout-test-roundtrip";
    writeLayout(key, {
      leftSize: 18,
      centerSize: 32,
      rightSize: 50,
      leftCollapsed: false,
      rightCollapsed: true,
      leftFilesSize: 40,
    });
    const got = readLayout(key);
    expect(got.leftSize).toBe(18);
    expect(got.centerSize).toBe(32);
    expect(got.rightSize).toBe(50);
    expect(got.rightCollapsed).toBe(true);
    expect(got.leftFilesSize).toBe(40);
  });
});

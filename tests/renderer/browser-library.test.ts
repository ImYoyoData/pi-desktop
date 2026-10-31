import { beforeEach, describe, expect, it } from "vitest";
import {
  clearTabHistory,
  listHistory,
  normalizeLibraryUrl,
  recordHistory,
} from "../../src/renderer/src/stores/browser-library";

const TAB_A = "browser-a";
const TAB_B = "browser-b";

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

beforeEach(() => {
  localStorage.clear();
});

describe("browser-library history", () => {
  it("keeps history independent per browser tab", () => {
    recordHistory(TAB_A, { url: "https://a.example/", title: "A" });
    recordHistory(TAB_B, { url: "https://b.example/", title: "B" });
    expect(listHistory(TAB_A).map((r) => r.url)).toEqual(["https://a.example/"]);
    expect(listHistory(TAB_B).map((r) => r.url)).toEqual(["https://b.example/"]);
  });

  it("records and dedupes by url (most recent first)", () => {
    recordHistory(TAB_A, { url: "https://a.example/", title: "A1" });
    recordHistory(TAB_A, { url: "https://b.example/", title: "B" });
    recordHistory(TAB_A, { url: "https://a.example/", title: "A2" });
    const rows = listHistory(TAB_A);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.url).toBe("https://a.example/");
    expect(rows[0]!.title).toBe("A2");
  });

  it("ignores about:blank", () => {
    expect(recordHistory(TAB_A, { url: "about:blank" })).toBeNull();
    expect(listHistory(TAB_A)).toHaveLength(0);
  });

  it("clears tab history", () => {
    recordHistory(TAB_A, { url: "https://a.example/" });
    clearTabHistory(TAB_A);
    expect(listHistory(TAB_A)).toHaveLength(0);
  });
});

describe("normalizeLibraryUrl", () => {
  it("drops blank urls", () => {
    expect(normalizeLibraryUrl("  ")).toBe("");
    expect(normalizeLibraryUrl("about:blank")).toBe("");
    expect(normalizeLibraryUrl(" https://a.example/ ")).toBe("https://a.example/");
  });
});

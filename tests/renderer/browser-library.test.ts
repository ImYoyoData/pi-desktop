import { beforeEach, describe, expect, it } from "vitest";
import {
  clearTabHistory,
  filterEntries,
  groupHistoryByRecency,
  isBookmarked,
  listBookmarks,
  listHistory,
  recordHistory,
  removeBookmark,
  removeHistory,
  toggleBookmark,
} from "../../src/renderer/src/stores/browser-library";

const TAB_A = "browser-a";
const TAB_B = "browser-b";
const WS = "C:\\work\\demo";
const WS_OTHER = "C:\\work\\other";

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

  it("removes by id", () => {
    const row = recordHistory(TAB_A, { url: "https://x.example/", title: "X" });
    expect(row).not.toBeNull();
    removeHistory(TAB_A, row!.id);
    expect(listHistory(TAB_A)).toHaveLength(0);
  });

  it("clears tab history", () => {
    recordHistory(TAB_A, { url: "https://a.example/" });
    clearTabHistory(TAB_A);
    expect(listHistory(TAB_A)).toHaveLength(0);
  });

  it("groups by recency", () => {
    const now = Date.now();
    const groups = groupHistoryByRecency([
      { id: "1", url: "https://t/", title: "T", visitedAt: now },
      {
        id: "2",
        url: "https://w/",
        title: "W",
        visitedAt: now - 2 * 24 * 60 * 60 * 1000,
      },
      {
        id: "3",
        url: "https://o/",
        title: "O",
        visitedAt: now - 30 * 24 * 60 * 60 * 1000,
      },
    ]);
    expect(groups.map((g) => g.key)).toEqual(["today", "week", "older"]);
  });
});

describe("browser-library bookmarks", () => {
  it("shares bookmarks within a workspace across tabs", () => {
    toggleBookmark(WS, { url: "https://bm.example/", title: "BM" });
    expect(isBookmarked(WS, "https://bm.example/")).toBe(true);
    expect(listBookmarks(WS)).toHaveLength(1);
  });

  it("keeps bookmarks separate per workspace", () => {
    toggleBookmark(WS, { url: "https://bm.example/", title: "BM" });
    expect(listBookmarks(WS_OTHER)).toHaveLength(0);
    expect(isBookmarked(WS_OTHER, "https://bm.example/")).toBe(false);
  });

  it("toggles bookmark", () => {
    expect(isBookmarked(WS, "https://bm.example/")).toBe(false);
    const on = toggleBookmark(WS, { url: "https://bm.example/", title: "BM" });
    expect(on.bookmarked).toBe(true);
    expect(isBookmarked(WS, "https://bm.example/")).toBe(true);
    const off = toggleBookmark(WS, { url: "https://bm.example/" });
    expect(off.bookmarked).toBe(false);
    expect(listBookmarks(WS)).toHaveLength(0);
  });

  it("removes bookmark by id", () => {
    const { entry } = toggleBookmark(WS, { url: "https://rm.example/", title: "RM" });
    removeBookmark(WS, entry!.id);
    expect(listBookmarks(WS)).toHaveLength(0);
  });

  it("seeds workspace bookmarks from legacy global list", () => {
    localStorage.setItem(
      "browser:bookmarks:v1",
      JSON.stringify([
        {
          id: "legacy",
          url: "https://legacy.example/",
          title: "Legacy",
          createdAt: 1,
        },
      ]),
    );
    expect(listBookmarks(WS).map((r) => r.url)).toEqual(["https://legacy.example/"]);
  });
});

describe("filterEntries", () => {
  it("filters by title or url", () => {
    const rows = [
      { title: "百度", url: "https://baidu.com" },
      { title: "Other", url: "https://example.com/foo" },
    ];
    expect(filterEntries(rows, "百度")).toHaveLength(1);
    expect(filterEntries(rows, "example")).toHaveLength(1);
    expect(filterEntries(rows, "")).toHaveLength(2);
  });
});

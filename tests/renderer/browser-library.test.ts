import { beforeEach, describe, expect, it } from "vitest";
import {
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
  it("records and dedupes by url (most recent first)", () => {
    recordHistory({ url: "https://a.example/", title: "A1" });
    recordHistory({ url: "https://b.example/", title: "B" });
    recordHistory({ url: "https://a.example/", title: "A2" });
    const rows = listHistory();
    expect(rows).toHaveLength(2);
    expect(rows[0].url).toBe("https://a.example/");
    expect(rows[0].title).toBe("A2");
  });

  it("ignores about:blank", () => {
    expect(recordHistory({ url: "about:blank" })).toBeNull();
    expect(listHistory()).toHaveLength(0);
  });

  it("removes by id", () => {
    const row = recordHistory({ url: "https://x.example/", title: "X" });
    expect(row).not.toBeNull();
    removeHistory(row!.id);
    expect(listHistory()).toHaveLength(0);
  });

  it("groups by recency", () => {
    const now = Date.now();
    localStorage.setItem(
      "browser:history:v1",
      JSON.stringify([
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
      ]),
    );
    const groups = groupHistoryByRecency(listHistory());
    expect(groups.map((g) => g.key)).toEqual(["today", "week", "older"]);
  });
});

describe("browser-library bookmarks", () => {
  it("toggles bookmark", () => {
    expect(isBookmarked("https://bm.example/")).toBe(false);
    const on = toggleBookmark({ url: "https://bm.example/", title: "BM" });
    expect(on.bookmarked).toBe(true);
    expect(isBookmarked("https://bm.example/")).toBe(true);
    const off = toggleBookmark({ url: "https://bm.example/" });
    expect(off.bookmarked).toBe(false);
    expect(listBookmarks()).toHaveLength(0);
  });

  it("removes bookmark by id", () => {
    const { entry } = toggleBookmark({ url: "https://rm.example/", title: "RM" });
    removeBookmark(entry!.id);
    expect(listBookmarks()).toHaveLength(0);
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

import { t } from "@renderer/i18n";

export interface BrowserLibraryEntry {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  visitedAt: number;
}

export interface BookmarkEntry {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  createdAt: number;
}

export type HistoryGroupKey = "today" | "week" | "older";

export interface HistoryGroup {
  key: HistoryGroupKey;
  label: string;
  items: BrowserLibraryEntry[];
}

/** Per browser-tab history (independent instances). */
const HISTORY_KEY_PREFIX = "browser:history:v2:tab:";
/** Workspace-shared bookmarks (all browser tabs in the same workspace). */
const BOOKMARKS_KEY_PREFIX = "browser:bookmarks:v2:ws:";
/** Legacy global keys — bookmarks migrate into workspace on first read. */
const LEGACY_HISTORY_KEY = "browser:history:v1";
const LEGACY_BOOKMARKS_KEY = "browser:bookmarks:v1";
const HISTORY_CAP = 200;

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function historyStorageKey(tabId: string): string {
  return `${HISTORY_KEY_PREFIX}${tabId}`;
}

function bookmarksStorageKey(workspaceRoot: string): string {
  return `${BOOKMARKS_KEY_PREFIX}${encodeURIComponent(workspaceRoot)}`;
}

export function normalizeLibraryUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed || trimmed === "about:blank") return "";
  return trimmed;
}

export function listHistory(tabId: string): BrowserLibraryEntry[] {
  if (!tabId) return [];
  const rows = readJson<BrowserLibraryEntry[]>(historyStorageKey(tabId), []);
  return Array.isArray(rows) ? rows : [];
}

export function recordHistory(
  tabId: string,
  input: {
    url: string;
    title?: string;
    favicon?: string;
  },
): BrowserLibraryEntry | null {
  if (!tabId) return null;
  const url = normalizeLibraryUrl(input.url);
  if (!url) return null;
  const now = Date.now();
  const title = (input.title || url).trim() || url;
  const existing = listHistory(tabId).filter((row) => row.url !== url);
  const entry: BrowserLibraryEntry = {
    id: newId(),
    url,
    title,
    favicon: input.favicon,
    visitedAt: now,
  };
  writeJson(historyStorageKey(tabId), [entry, ...existing].slice(0, HISTORY_CAP));
  return entry;
}

export function removeHistory(tabId: string, id: string): void {
  if (!tabId) return;
  writeJson(
    historyStorageKey(tabId),
    listHistory(tabId).filter((row) => row.id !== id),
  );
}

/** Drop a tab's history when the browser tab is closed. */
export function clearTabHistory(tabId: string): void {
  if (!tabId) return;
  try {
    localStorage.removeItem(historyStorageKey(tabId));
  } catch {
    // ignore
  }
}

export function listBookmarks(workspaceRoot: string | null | undefined): BookmarkEntry[] {
  if (!workspaceRoot) {
    const legacy = readJson<BookmarkEntry[]>(LEGACY_BOOKMARKS_KEY, []);
    return Array.isArray(legacy) ? legacy : [];
  }
  const key = bookmarksStorageKey(workspaceRoot);
  const rows = readJson<BookmarkEntry[] | null>(key, null);
  if (Array.isArray(rows)) return rows;
  // First open for this workspace: seed from legacy global bookmarks if any.
  const legacy = readJson<BookmarkEntry[]>(LEGACY_BOOKMARKS_KEY, []);
  if (Array.isArray(legacy) && legacy.length) {
    writeJson(key, legacy);
    return legacy;
  }
  writeJson(key, []);
  return [];
}

export function isBookmarked(
  workspaceRoot: string | null | undefined,
  url: string,
): boolean {
  const normalized = normalizeLibraryUrl(url);
  if (!normalized) return false;
  return listBookmarks(workspaceRoot).some((row) => row.url === normalized);
}

export function toggleBookmark(
  workspaceRoot: string | null | undefined,
  input: {
    url: string;
    title?: string;
    favicon?: string;
  },
): { bookmarked: boolean; entry: BookmarkEntry | null } {
  const url = normalizeLibraryUrl(input.url);
  if (!url) return { bookmarked: false, entry: null };
  const current = listBookmarks(workspaceRoot);
  const found = current.find((row) => row.url === url);
  const next = found
    ? current.filter((row) => row.url !== url)
    : [
        {
          id: newId(),
          url,
          title: (input.title || url).trim() || url,
          favicon: input.favicon,
          createdAt: Date.now(),
        } satisfies BookmarkEntry,
        ...current,
      ];
  if (workspaceRoot) {
    writeJson(bookmarksStorageKey(workspaceRoot), next);
  } else {
    writeJson(LEGACY_BOOKMARKS_KEY, next);
  }
  if (found) return { bookmarked: false, entry: null };
  return { bookmarked: true, entry: next[0]! };
}

export function removeBookmark(
  workspaceRoot: string | null | undefined,
  id: string,
): void {
  const next = listBookmarks(workspaceRoot).filter((row) => row.id !== id);
  if (workspaceRoot) {
    writeJson(bookmarksStorageKey(workspaceRoot), next);
  } else {
    writeJson(LEGACY_BOOKMARKS_KEY, next);
  }
}

export function filterEntries<T extends { title: string; url: string }>(
  entries: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (row) => row.title.toLowerCase().includes(q) || row.url.toLowerCase().includes(q),
  );
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function groupHistoryByRecency(entries: BrowserLibraryEntry[]): HistoryGroup[] {
  const todayStart = startOfToday();
  const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;
  const today: BrowserLibraryEntry[] = [];
  const week: BrowserLibraryEntry[] = [];
  const older: BrowserLibraryEntry[] = [];
  for (const row of entries) {
    if (row.visitedAt >= todayStart) today.push(row);
    else if (row.visitedAt >= weekStart) week.push(row);
    else older.push(row);
  }
  const groups: HistoryGroup[] = [];
  if (today.length) groups.push({ key: "today", label: t.historyToday, items: today });
  if (week.length) groups.push({ key: "week", label: t.historyWeek, items: week });
  if (older.length) groups.push({ key: "older", label: t.historyOlder, items: older });
  return groups;
}

/** Best-effort cleanup of unused legacy global history (no longer shared). */
export function dropLegacyGlobalHistory(): void {
  try {
    localStorage.removeItem(LEGACY_HISTORY_KEY);
  } catch {
    // ignore
  }
}

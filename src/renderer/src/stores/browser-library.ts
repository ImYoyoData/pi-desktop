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

const HISTORY_KEY = "browser:history:v1";
const BOOKMARKS_KEY = "browser:bookmarks:v1";
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

export function normalizeLibraryUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed || trimmed === "about:blank") return "";
  return trimmed;
}

export function listHistory(): BrowserLibraryEntry[] {
  const rows = readJson<BrowserLibraryEntry[]>(HISTORY_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

export function recordHistory(input: {
  url: string;
  title?: string;
  favicon?: string;
}): BrowserLibraryEntry | null {
  const url = normalizeLibraryUrl(input.url);
  if (!url) return null;
  const now = Date.now();
  const title = (input.title || url).trim() || url;
  const existing = listHistory().filter((row) => row.url !== url);
  const entry: BrowserLibraryEntry = {
    id: newId(),
    url,
    title,
    favicon: input.favicon,
    visitedAt: now,
  };
  writeJson(HISTORY_KEY, [entry, ...existing].slice(0, HISTORY_CAP));
  return entry;
}

export function removeHistory(id: string): void {
  writeJson(
    HISTORY_KEY,
    listHistory().filter((row) => row.id !== id),
  );
}

export function listBookmarks(): BookmarkEntry[] {
  const rows = readJson<BookmarkEntry[]>(BOOKMARKS_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

export function isBookmarked(url: string): boolean {
  const normalized = normalizeLibraryUrl(url);
  if (!normalized) return false;
  return listBookmarks().some((row) => row.url === normalized);
}

export function toggleBookmark(input: {
  url: string;
  title?: string;
  favicon?: string;
}): { bookmarked: boolean; entry: BookmarkEntry | null } {
  const url = normalizeLibraryUrl(input.url);
  if (!url) return { bookmarked: false, entry: null };
  const current = listBookmarks();
  const found = current.find((row) => row.url === url);
  if (found) {
    writeJson(
      BOOKMARKS_KEY,
      current.filter((row) => row.url !== url),
    );
    return { bookmarked: false, entry: null };
  }
  const entry: BookmarkEntry = {
    id: newId(),
    url,
    title: (input.title || url).trim() || url,
    favicon: input.favicon,
    createdAt: Date.now(),
  };
  writeJson(BOOKMARKS_KEY, [entry, ...current]);
  return { bookmarked: true, entry };
}

export function removeBookmark(id: string): void {
  writeJson(
    BOOKMARKS_KEY,
    listBookmarks().filter((row) => row.id !== id),
  );
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
  if (today.length) groups.push({ key: "today", label: "今天", items: today });
  if (week.length) groups.push({ key: "week", label: "最近 7 天", items: week });
  if (older.length) groups.push({ key: "older", label: "更早", items: older });
  return groups;
}

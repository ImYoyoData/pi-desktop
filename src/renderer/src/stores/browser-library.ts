import * as prefs from "@renderer/utils/prefs";

export interface BrowserLibraryEntry {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  visitedAt: number;
}

/** Per browser-tab history (independent instances). */
const HISTORY_KEY_PREFIX = "browser:history:v2:tab:";
const HISTORY_CAP = 200;

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = prefs.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  prefs.setItem(key, JSON.stringify(value));
}

function historyStorageKey(tabId: string): string {
  return `${HISTORY_KEY_PREFIX}${tabId}`;
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

/** Drop a tab's history when the browser tab is closed. */
export function clearTabHistory(tabId: string): void {
  if (!tabId) return;
  try {
    prefs.removeItem(historyStorageKey(tabId));
  } catch {
    // ignore
  }
}

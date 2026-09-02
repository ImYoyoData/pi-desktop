import fs from "node:fs/promises";
import { rmSync } from "node:fs";
import type {
  SessionHistoryMessage,
  SessionHistoryPage,
} from "../shared/protocol";
import { sessionTimingPath } from "../shared/session-timing";
import { deleteChatMeta, readChatMeta } from "./session-chat-meta";
import { deleteImageCache } from "./session-image-cache";
import {
  parseSessionHistoryJsonl,
  parseSessionHistoryPageFromJsonl,
} from "./session-history-parse";
import {
  parseHistoryOffMain,
  parseHistoryPageOffMain,
} from "./session-history-offload";

/** Default page size for chat UI history (tail / older pages). Disk jsonl stays full (shared with Pi CLI). */
export const SESSION_HISTORY_PAGE_SIZE = 30;

function deleteTimingMeta(filePath: string): void {
  try {
    rmSync(sessionTimingPath(filePath), { force: true });
  } catch {
    // ignore
  }
}

type HistoryCacheEntry = {
  mtimeMs: number;
  messages: SessionHistoryMessage[];
};

const historyCache = new Map<string, HistoryCacheEntry>();

/** Small LRU of page results — avoids re-parsing when scrolling up/down quickly. */
type PageCacheEntry = {
  mtimeMs: number;
  key: string;
  page: SessionHistoryPage;
};
const pageCache = new Map<string, PageCacheEntry[]>();
const PAGE_CACHE_PER_FILE = 6;

export function invalidateSessionHistoryCache(filePath?: string): void {
  if (!filePath) {
    historyCache.clear();
    pageCache.clear();
    return;
  }
  historyCache.delete(filePath);
  pageCache.delete(filePath);
}

function pageCacheKey(limit: number, beforeId: string | null): string {
  return `${limit}:${beforeId ?? ""}`;
}

function readPageCache(
  filePath: string,
  mtimeMs: number,
  limit: number,
  beforeId: string | null,
): SessionHistoryPage | null {
  const rows = pageCache.get(filePath);
  if (!rows?.length) return null;
  const key = pageCacheKey(limit, beforeId);
  const hit = rows.find((r) => r.mtimeMs === mtimeMs && r.key === key);
  return hit?.page ?? null;
}

function writePageCache(
  filePath: string,
  mtimeMs: number,
  limit: number,
  beforeId: string | null,
  page: SessionHistoryPage,
): void {
  const key = pageCacheKey(limit, beforeId);
  const rows = pageCache.get(filePath) ?? [];
  const next = [
    { mtimeMs, key, page },
    ...rows.filter((r) => r.key !== key),
  ].slice(0, PAGE_CACHE_PER_FILE);
  pageCache.set(filePath, next);
  if (pageCache.size > 32) {
    const first = pageCache.keys().next().value;
    if (typeof first === "string") pageCache.delete(first);
  }
}

async function loadAllHistoryMessages(
  filePath: string,
): Promise<SessionHistoryMessage[]> {
  let st: { mtimeMs: number };
  try {
    st = await fs.stat(filePath);
  } catch {
    return [];
  }
  const hit = historyCache.get(filePath);
  if (hit && hit.mtimeMs === st.mtimeMs) {
    return hit.messages;
  }

  let messages: SessionHistoryMessage[];
  try {
    // Heavy JSONL parse off the main process (large sessions freeze every window).
    messages = await parseHistoryOffMain(filePath);
  } catch (err) {
    console.warn(
      "[pi-desktop] history worker failed; falling back on main",
      err,
    );
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      return [];
    }
    messages = parseSessionHistoryJsonl(raw, readChatMeta(filePath));
  }

  historyCache.set(filePath, { mtimeMs: st.mtimeMs, messages });
  if (historyCache.size > 24) {
    const first = historyCache.keys().next().value;
    if (typeof first === "string") historyCache.delete(first);
  }
  return messages;
}

/** Full leaf-path history (tests / callers that need everything). */
export async function readSessionHistoryMessages(
  filePath: string,
): Promise<SessionHistoryMessage[]> {
  return loadAllHistoryMessages(filePath);
}

/**
 * Paginated history for the chat UI.
 * - No beforeId → last `limit` messages (tail).
 * - beforeId → up to `limit` messages strictly older than that id.
 *
 * Uses a page-aware worker path so unused image payloads are never materialized
 * into the IPC result (or the full-history cache).
 */
export async function readSessionHistoryPage(
  filePath: string,
  opts?: { limit?: number; beforeId?: string | null },
): Promise<SessionHistoryPage> {
  const limit = Math.max(
    1,
    Math.min(200, opts?.limit ?? SESSION_HISTORY_PAGE_SIZE),
  );
  const beforeId = opts?.beforeId?.trim() || null;

  let st: { mtimeMs: number };
  try {
    st = await fs.stat(filePath);
  } catch {
    return { messages: [], hasMore: false, total: 0 };
  }

  const cached = readPageCache(filePath, st.mtimeMs, limit, beforeId);
  if (cached) return cached;

  // Prefer full-history cache only when it already exists (e.g. tests / rare full reads).
  // Do not populate it from a page request — that would defeat the point.
  const fullHit = historyCache.get(filePath);
  if (fullHit && fullHit.mtimeMs === st.mtimeMs) {
    const all = fullHit.messages;
    const total = all.length;
    if (total === 0) {
      const empty = { messages: [], hasMore: false, total: 0 };
      writePageCache(filePath, st.mtimeMs, limit, beforeId, empty);
      return empty;
    }
    let end = total;
    if (beforeId) {
      const idx = all.findIndex((m) => m.id === beforeId);
      if (idx < 0 || idx === 0) {
        const empty = { messages: [], hasMore: false, total };
        writePageCache(filePath, st.mtimeMs, limit, beforeId, empty);
        return empty;
      }
      end = idx;
    }
    const start = Math.max(0, end - limit);
    const page = {
      messages: all.slice(start, end),
      hasMore: start > 0,
      total,
    };
    writePageCache(filePath, st.mtimeMs, limit, beforeId, page);
    return page;
  }

  let page: SessionHistoryPage;
  try {
    page = await parseHistoryPageOffMain(filePath, { limit, beforeId });
  } catch (err) {
    console.warn(
      "[pi-desktop] history page worker failed; falling back on main",
      err,
    );
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      return { messages: [], hasMore: false, total: 0 };
    }
    page = parseSessionHistoryPageFromJsonl(raw, {
      limit,
      beforeId,
      chatMeta: readChatMeta(filePath),
    });
  }

  writePageCache(filePath, st.mtimeMs, limit, beforeId, page);
  return page;
}

/** Drop conversation entries; keep session header + metadata (name, model, thinking). */
export async function clearSessionConversation(
  filePath: string,
): Promise<void> {
  deleteChatMeta(filePath);
  deleteTimingMeta(filePath);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return;
  }

  const dropTypes = new Set([
    "message",
    "compaction",
    "branch_summary",
    "custom_message",
    "label",
  ]);

  const kept: string[] = [];
  let header: string | null = null;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = typeof parsed.type === "string" ? parsed.type : "";
    if (type === "session") {
      header = trimmed;
      kept.push(trimmed);
      continue;
    }
    if (dropTypes.has(type)) continue;
    kept.push(trimmed);
  }

  if (!header) {
    return;
  }

  await fs.writeFile(filePath, `${kept.join("\n")}\n`, "utf8");
  invalidateSessionHistoryCache(filePath);
}

export async function deleteSessionFile(filePath: string): Promise<void> {
  invalidateSessionHistoryCache(filePath);
  deleteChatMeta(filePath);
  deleteTimingMeta(filePath);
  deleteImageCache(filePath);
  await fs.unlink(filePath);
}

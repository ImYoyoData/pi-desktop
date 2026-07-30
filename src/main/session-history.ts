import fs from "node:fs/promises";
import type { SessionHistoryMessage, SessionHistoryPage } from "../shared/protocol";
import { stripComposerModePreamble } from "../shared/composer-modes";

type ParsedEntry = {
  id: string;
  parentId: string | null;
  timestamp: string;
  type: string;
  message?: Record<string, unknown>;
};

/** Default page size for chat UI history (tail / older pages). Disk jsonl stays full (shared with Pi CLI). */
export const SESSION_HISTORY_PAGE_SIZE = 30;

/** Cap oversized tool/assistant blobs so renderer IPC stays light. */
const MAX_UI_TEXT_CHARS = 24_000;

type HistoryCacheEntry = {
  mtimeMs: number;
  messages: SessionHistoryMessage[];
};

const historyCache = new Map<string, HistoryCacheEntry>();

function truncateForUi(text: string, max = MAX_UI_TEXT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… (${text.length - max} more chars)`;
}

function truncateArgsForUi(args: unknown): unknown {
  if (args == null || typeof args !== "object") return args;
  try {
    const raw = JSON.stringify(args);
    if (raw.length <= MAX_UI_TEXT_CHARS) return args;
    return {
      _truncated: true,
      preview: `${raw.slice(0, MAX_UI_TEXT_CHARS)}… (${raw.length - MAX_UI_TEXT_CHARS} more chars)`,
    };
  } catch {
    return args;
  }
}

function textFromAgentMessage(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((part): part is { type: string; text: string } => {
      return Boolean(part && typeof part === "object" && (part as { type?: string }).type === "text");
    })
    .map((part) => part.text)
    .join("");
}

function thinkingFromAgentMessage(message: Record<string, unknown>): string {
  const content = message.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: string; thinking: string } => {
      return (
        Boolean(part) &&
        typeof part === "object" &&
        (part as { type?: string }).type === "thinking" &&
        typeof (part as { thinking?: unknown }).thinking === "string"
      );
    })
    .map((part) => part.thinking)
    .join("");
}

/** Collect toolCall id → arguments from an assistant message content array. */
function toolCallArgsFromAssistant(message: Record<string, unknown>): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const content = message.content;
  if (!Array.isArray(content)) return out;
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const row = part as { type?: unknown; id?: unknown; arguments?: unknown };
    if (row.type !== "toolCall" || typeof row.id !== "string" || !row.id) continue;
    out.set(row.id, row.arguments);
  }
  return out;
}

function findLeafId(entries: ParsedEntry[]): string | null {
  const hasChild = new Set<string>();
  for (const entry of entries) {
    if (entry.parentId) {
      hasChild.add(entry.parentId);
    }
  }
  const leaves = entries.filter((entry) => entry.id && !hasChild.has(entry.id));
  if (leaves.length === 0) {
    return null;
  }
  leaves.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return leaves[0]?.id ?? null;
}

function buildMessagesFromEntries(entries: ParsedEntry[]): SessionHistoryMessage[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let leafId = findLeafId(entries);
  const pathIds: string[] = [];
  while (leafId) {
    pathIds.push(leafId);
    const entry = byId.get(leafId);
    leafId = entry?.parentId ?? null;
  }
  pathIds.reverse();

  const messages: SessionHistoryMessage[] = [];
  const toolCallArgsById = new Map<string, unknown>();
  for (const id of pathIds) {
    const entry = byId.get(id);
    if (!entry || entry.type !== "message" || !entry.message) {
      continue;
    }
    const role = entry.message.role;
    if (role === "user") {
      const text = stripComposerModePreamble(textFromAgentMessage(entry.message));
      if (text) {
        messages.push({ id: entry.id, role: "user", text: truncateForUi(text) });
      }
    } else if (role === "assistant") {
      for (const [callId, args] of toolCallArgsFromAssistant(entry.message)) {
        toolCallArgsById.set(callId, args);
      }
      const text = textFromAgentMessage(entry.message);
      const thinking = thinkingFromAgentMessage(entry.message);
      if (text || thinking) {
        messages.push({
          id: entry.id,
          role: "assistant",
          text: truncateForUi(text),
          ...(thinking ? { thinking: truncateForUi(thinking, 16_000) } : {}),
        });
      }
    } else if (role === "toolResult") {
      const toolCallId =
        typeof entry.message.toolCallId === "string" ? entry.message.toolCallId : entry.id;
      const toolName =
        typeof entry.message.toolName === "string" && entry.message.toolName.trim()
          ? entry.message.toolName
          : "tool";
      const text = textFromAgentMessage(entry.message);
      const args = toolCallArgsById.get(toolCallId);
      messages.push({
        id: entry.id,
        role: "tool",
        toolCallId,
        toolName,
        text: truncateForUi(text),
        isError: Boolean(entry.message.isError),
        ...(args !== undefined ? { args: truncateArgsForUi(args) } : {}),
      });
    }
  }

  return messages;
}

export function invalidateSessionHistoryCache(filePath?: string): void {
  if (!filePath) {
    historyCache.clear();
    return;
  }
  historyCache.delete(filePath);
}

async function loadAllHistoryMessages(filePath: string): Promise<SessionHistoryMessage[]> {
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

  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }

  const entries: ParsedEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof parsed.type !== "string" || typeof parsed.id !== "string") {
      continue;
    }
    entries.push({
      id: parsed.id,
      parentId: typeof parsed.parentId === "string" ? parsed.parentId : null,
      timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : "",
      type: parsed.type,
      message:
        parsed.message && typeof parsed.message === "object"
          ? (parsed.message as Record<string, unknown>)
          : undefined,
    });
  }

  const messages = buildMessagesFromEntries(entries);
  historyCache.set(filePath, { mtimeMs: st.mtimeMs, messages });
  // Soft cap: drop oldest cache entries if too many sessions are open in memory.
  if (historyCache.size > 24) {
    const first = historyCache.keys().next().value;
    if (typeof first === "string") historyCache.delete(first);
  }
  return messages;
}

/** Full leaf-path history (tests / callers that need everything). */
export async function readSessionHistoryMessages(filePath: string): Promise<SessionHistoryMessage[]> {
  return loadAllHistoryMessages(filePath);
}

/**
 * Paginated history for the chat UI.
 * - No beforeId → last `limit` messages (tail).
 * - beforeId → up to `limit` messages strictly older than that id.
 */
export async function readSessionHistoryPage(
  filePath: string,
  opts?: { limit?: number; beforeId?: string | null },
): Promise<SessionHistoryPage> {
  const limit = Math.max(1, Math.min(200, opts?.limit ?? SESSION_HISTORY_PAGE_SIZE));
  const beforeId = opts?.beforeId?.trim() || null;
  const all = await loadAllHistoryMessages(filePath);
  const total = all.length;

  if (total === 0) {
    return { messages: [], hasMore: false, total: 0 };
  }

  let end = total;
  if (beforeId) {
    const idx = all.findIndex((m) => m.id === beforeId);
    if (idx < 0) {
      // Cursor not in file (stale UI id) — stop paging rather than looping forever.
      return { messages: [], hasMore: false, total };
    }
    if (idx === 0) {
      return { messages: [], hasMore: false, total };
    }
    end = idx;
  }

  const start = Math.max(0, end - limit);
  return {
    messages: all.slice(start, end),
    hasMore: start > 0,
    total,
  };
}

/** Drop conversation entries; keep session header + metadata (name, model, thinking). */
export async function clearSessionConversation(filePath: string): Promise<void> {
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
    // Keep thinking_level_change / model_change / session_info / custom metadata.
    kept.push(trimmed);
  }

  if (!header) {
    // Corrupt / unexpected — refuse to wipe the whole file silently.
    return;
  }

  await fs.writeFile(filePath, `${kept.join("\n")}\n`, "utf8");
  invalidateSessionHistoryCache(filePath);
}

export async function deleteSessionFile(filePath: string): Promise<void> {
  invalidateSessionHistoryCache(filePath);
  await fs.unlink(filePath);
}

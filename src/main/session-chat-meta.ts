import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import {
  chatMetaPath,
  type ChatMessageTag,
  type SessionChatMeta,
  type SessionChatMetaEntry,
} from "../shared/chat-meta";

/**
 * Read the per-session UI-meta sidecar (attachment tags for user messages).
 * Returns [] when the sidecar is missing or corrupt.
 */
export function readChatMeta(filePath: string): SessionChatMetaEntry[] {
  const path = chatMetaPath(filePath);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SessionChatMeta>;
    if (!Array.isArray(parsed?.entries)) return [];
    return parsed.entries.filter(
      (e) => e && typeof e.text === "string" && Array.isArray(e.tags),
    ) as SessionChatMetaEntry[];
  } catch {
    return [];
  }
}

/**
 * Append one user-message tag entry. Entries are keyed by the exact agent
 * text so history reload can match them back to the persisted message.
 */
export function appendChatMeta(
  filePath: string,
  text: string,
  tags: ChatMessageTag[],
  displayText?: string,
): void {
  if (!text || (!tags.length && !displayText)) return;
  const path = chatMetaPath(filePath);
  let meta: SessionChatMeta = { version: 1, entries: [] };
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SessionChatMeta>;
      if (parsed && Array.isArray(parsed.entries)) meta = parsed as SessionChatMeta;
    } catch {
      // corrupt sidecar — start fresh
    }
  }
  const existing = meta.entries.find((e) => e.text === text);
  if (existing) {
    if (tags.length) existing.tags = tags;
    if (displayText) existing.displayText = displayText;
  } else {
    meta.entries.push({
      text,
      tags,
      ...(displayText ? { displayText } : {}),
    });
  }
  writeFileSync(path, JSON.stringify(meta, null, 2), { encoding: "utf8" });
}

export function deleteChatMeta(filePath: string): void {
  const path = chatMetaPath(filePath);
  try {
    if (existsSync(path)) rmSync(path, { force: true });
  } catch {
    // ignore
  }
}

export function renameChatMeta(oldPath: string, newPath: string): void {
  const from = chatMetaPath(oldPath);
  const to = chatMetaPath(newPath);
  try {
    if (existsSync(from)) renameSync(from, to);
  } catch {
    // ignore
  }
}

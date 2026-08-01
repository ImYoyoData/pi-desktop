/**
 * Per-session attachment metadata (file / url / element chips) persisted
 * next to the Pi session jsonl so chat tags survive history reloads.
 */
import { BUILTIN_BROWSER_SELECTION_HEADER } from "./builtin-browser";

/**
 * Attachment chip rendered in the user bubble. Mirrors ChatMessage.elementTags.
 */
export type ChatMessageTag = {
  url: string;
  host: string;
  label: string;
  content?: string;
  kind?: "file" | "url" | "element" | "agent" | "plan" | "ask" | "task";
};

/** Sidecar file adjacent to the session jsonl. */
export const CHAT_META_SUFFIX = ".ui-meta.json";

export type SessionChatMetaEntry = {
  /** Agent-facing message text (exactly what was passed to the model). */
  text: string;
  tags: ChatMessageTag[];
};

export type SessionChatMeta = {
  version: 1;
  entries: SessionChatMetaEntry[];
};

export function chatMetaPath(filePath: string): string {
  return `${filePath}${CHAT_META_SUFFIX}`;
}

/**
 * Remove the "Context from browser selection" block that the worker
 * prepends when a prompt carries element citations, so the original agent
 * text (and the display text) can be recovered from history.
 */
export function stripSelectionCitationsBlock(text: string): string {
  const raw = text ?? "";
  const idx = raw.indexOf(BUILTIN_BROWSER_SELECTION_HEADER);
  if (idx < 0) return raw;
  const tail = raw.slice(idx + BUILTIN_BROWSER_SELECTION_HEADER.length);
  const end = /\r?\n---\r?\n/.exec(tail);
  if (!end) return raw.slice(0, idx).trimEnd();
  return (raw.slice(0, idx) + tail.slice((end.index ?? 0) + end[0].length)).trim();
}

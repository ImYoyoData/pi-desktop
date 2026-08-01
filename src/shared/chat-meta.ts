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
/**
 * Remove the trailing `[attached images]` block that the composer appends to
 * the agent prompt (cached image paths for text-only models). It must not
 * appear in the chat bubble when history is reloaded.
 */
export function stripAttachedImagesBlock(text: string): string {
  const raw = text ?? "";
  return raw.replace(/\r?\n\r?\n\[attached images\]\r?\n(?:- [^\r\n]*\r?\n?)+$/, "");
}

export function stripSelectionCitationsBlock(text: string): string {
  const raw = text ?? "";
  const idx = raw.indexOf(BUILTIN_BROWSER_SELECTION_HEADER);
  if (idx < 0) return raw;
  const tail = raw.slice(idx + BUILTIN_BROWSER_SELECTION_HEADER.length);
  const end = /\r?\n---\r?\n/.exec(tail);
  if (!end) return raw.slice(0, idx).trimEnd();
  return (raw.slice(0, idx) + tail.slice((end.index ?? 0) + end[0].length)).trim();
}

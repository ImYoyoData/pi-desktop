/** Active `@path` mention in the composer draft (file path picker). */

import { rankFuzzyPathEntries } from "./fuzzy-path";

export type AtFileContext = {
  /** Text after `@` (may include `/` path segments and spaces for multi-token fuzzy). */
  query: string;
  /** Absolute start index of `@` in the full draft. */
  atIndex: number;
};

/**
 * Detect an `@query` token at the end of the draft.
 * Query may include spaces (multi-token fuzzy) but not newlines or a second `@`.
 */
export function parseAtFileContext(draft: string): AtFileContext | null {
  // Last `@` that starts a token (start of draft or after whitespace / newline).
  const match = /(?:^|[\s\u3000])@([^\n@]*)$/u.exec(draft);
  if (!match) return null;
  const query = match[1] ?? "";
  const atIndex = draft.length - query.length - 1;
  if (draft[atIndex] !== "@") return null;
  return { query, atIndex };
}

/** Remove the active `@query` token (keeps any leading space before `@`). */
export function replaceAtFileMention(draft: string, ctx: AtFileContext): string {
  return draft.slice(0, ctx.atIndex).replace(/[ \t]+$/u, "");
}

export type AtFileItem = {
  name: string;
  /** Workspace-relative path with `/` separators. */
  path: string;
  kind: "file" | "dir";
};

/** Filter/rank entries with fuzzy matching on name/path. */
export function filterAtFileItems(items: AtFileItem[], query: string): AtFileItem[] {
  const q = query.trim();
  if (!q) return items;
  return rankFuzzyPathEntries(q, items);
}

/** Directory portion of a relative path (secondary label in the picker). */
export function atFileDirLabel(relPath: string): string {
  const norm = relPath.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  if (idx <= 0) return "";
  return norm.slice(0, idx);
}

/** Desktop slash-command catalog (Skills + builtins we already support). */

export type SlashItemKind = "builtin" | "skill";

export type SlashItem = {
  id: string;
  kind: SlashItemKind;
  /** Command text without leading `/`, e.g. `compact` or `skill:foo`. */
  command: string;
  title: string;
  description: string;
};

export type SlashBuiltinId = "new" | "compact" | "model";

export const SLASH_BUILTIN_IDS: readonly SlashBuiltinId[] = [
  "new",
  "compact",
  "model",
] as const;

export function isSlashBuiltinId(v: string): v is SlashBuiltinId {
  return v === "new" || v === "compact" || v === "model";
}

/** Active `/query` on the last line of the composer draft. */
export type SlashContext = {
  /** Text after `/` on the last line (may include `skill:` prefix). */
  query: string;
  /** Absolute start index of `/` in the full draft. */
  slashIndex: number;
  /** Full last-line text including `/`. */
  line: string;
};

/**
 * Detect a slash menu context on the last line.
 * Closes once the user types a space after the command token (args mode),
 * except we still match bare `/` and partial filters.
 */
export function parseSlashContext(draft: string): SlashContext | null {
  const slashIndex = draft.lastIndexOf("\n") + 1;
  const line = draft.slice(slashIndex);
  if (!line.startsWith("/")) return null;
  const body = line.slice(1);
  // `/skill:name args` → leave menu once args begin (space after token).
  if (/\s/.test(body)) return null;
  return { query: body, slashIndex, line };
}

export function skillSlashCommand(name: string): string {
  return `skill:${name.trim()}`;
}

export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const hay = `${item.command} ${item.title} ${item.description}`.toLowerCase();
    return hay.includes(q) || item.command.toLowerCase().startsWith(q);
  });
}

/** Replace the active slash line with `/${command}` (+ optional trailing space). */
export function replaceSlashLine(
  draft: string,
  ctx: SlashContext,
  command: string,
  trailingSpace = false,
): string {
  const prefix = draft.slice(0, ctx.slashIndex);
  const next = `/${command}${trailingSpace ? " " : ""}`;
  return `${prefix}${next}`;
}

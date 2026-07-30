/** Heuristic session title from first user message (pi-web default style, no model). */
export function heuristicSessionTitle(raw: string, maxLen = 42): string {
  // Strip selection dumps before collapsing whitespace (header uses newlines).
  let text = raw
    .replace(
      /^(?:#\s*内置浏览器[^\n]*\r?\n+)?Context from browser selection:[\s\S]*?---\s*/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  text = text.replace(/^[@#]\S+\s+/g, "").trim();
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1))}…`;
}

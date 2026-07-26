/** Heuristic session title from first user message (pi-web default style, no model). */
export function heuristicSessionTitle(raw: string, maxLen = 42): string {
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return "";
  // Drop common chat prefixes / noise dumps
  text = text.replace(/^Context from browser selection:[\s\S]*?---\s*/i, "").trim();
  text = text.replace(/^[@#]\S+\s+/g, "").trim();
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1))}…`;
}

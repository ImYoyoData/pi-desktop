/** Truncate UI labels for right-pane tabs (browser title / terminal command). */
export function truncateTabLabel(raw: string, max = 24): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** Strip common shell control noise from a typed command line. */
export function sanitizeTerminalCommandLabel(raw: string): string {
  return raw
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

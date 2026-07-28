/** Truncate UI labels for right-pane tabs (browser title / terminal command). */
export function truncateTabLabel(raw: string, max = 24): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Clean a first-typed shell line into a compact tab title:
 * drop ANSI/control noise, prompt junk, quotes, chain/pipe tails,
 * and path prefixes on the executable (keep short args).
 */
export function sanitizeTerminalCommandLabel(raw: string): string {
  let text = raw
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/[\u200b-\u200f\u2028-\u202f\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // ESC is often dropped by input capture; leftover focus-in (`[I`) / focus-out (`[O`)
  // / bracketed-paste (`[200~`) fragments must not become part of the tab title.
  while (/^\[(?:[IO]|[0-9;]*~)/.test(text)) {
    text = text.replace(/^\[(?:[IO]|[0-9;]*~)/, "").trim();
  }

  // Leading prompt / continuation markers
  text = text.replace(/^[>$%#]+(?:\s+|$)/, "").trim();

  // Only the first command in a chain / pipeline / background job
  text = (text.split(/\s*(?:&&|\|\||;;)\s*/)[0] ?? text).trim();
  text = (text.split(/\s*[|;&]\s*/)[0] ?? text).trim();

  // Whole-line wrapping quotes
  if (
    (text.startsWith('"') && text.endsWith('"') && text.length >= 2) ||
    (text.startsWith("'") && text.endsWith("'") && text.length >= 2) ||
    (text.startsWith("`") && text.endsWith("`") && text.length >= 2)
  ) {
    text = text.slice(1, -1).trim();
  }

  const tokenMatch = text.match(/^("([^"]*)"|'([^']*)'|`([^`]*)`|[^\s]+)(?:\s+(.*))?$/);
  if (!tokenMatch) return "";

  let cmd = tokenMatch[2] ?? tokenMatch[3] ?? tokenMatch[4] ?? tokenMatch[1] ?? "";
  const args = (tokenMatch[5] ?? "").trim();
  cmd = cmd.replace(/^["'`]+|["'`]+$/g, "");
  // `./foo`, `C:\bin\npm.cmd`, `/usr/bin/git` → basename
  cmd = cmd.replace(/^.*[/\\]/, "");
  // Windows launcher extensions are noise in a tab title
  cmd = cmd.replace(/\.(exe|cmd|bat|ps1|com)$/i, "");
  // Drop leftover quote / paren clutter from the display label
  const cleanArgs = args
    .replace(/["'`]/g, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  text = cleanArgs ? `${cmd} ${cleanArgs}` : cmd;
  return text.replace(/\s+/g, " ").trim();
}

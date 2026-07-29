/**
 * Heuristics + markers so long-lived shell commands (dev servers, watchers)
 * detach into the Running panel instead of blocking the agent turn.
 */

/** Explicit opt-in the model can append (stripped before spawn). */
export const BASH_BACKGROUND_MARKER = "# pi-desktop:background";

const PERSISTENT_PATTERNS: RegExp[] = [
  /\bnpm\s+(run\s+)?(dev|start|serve)\b/i,
  /\bpnpm\s+(run\s+)?(dev|start|serve)\b/i,
  /\byarn\s+(run\s+)?(dev|start|serve)\b/i,
  /\bbun\s+(run\s+)?(dev|start|serve)\b/i,
  /\bnpx\s+[^\n]*\b(vite|next|nuxt|webpack-dev-server|http-server|serve)\b/i,
  /\b(vite|next|nuxt|webpack-dev-server)\b/i,
  /\bdocker\s+compose\s+up\b/i,
  /\bdocker-compose\s+up\b/i,
  /\b(uvicorn|gunicorn|hypercorn)\b[^\n]*\b(--reload)?/i,
  /\bflask\s+run\b/i,
  /\bphp\s+-S\b/i,
  /\brails\s+s(erver)?\b/i,
  /\bcargo\s+watch\b/i,
  /\bnodemon\b/i,
  /\bwatchman\b/i,
  /\btail\s+-f\b/i,
  /\bpython(\d+(\.\d+)?)?\s+-m\s+(http\.server|uvicorn)\b/i,
];

/** Commands that intentionally fork / hide a process outside the shell tree. */
const DETACH_PATTERNS: RegExp[] = [
  /(?:^|[\s;|&])&\s*$/,
  /\bnohup\b/i,
  /\bstart-process\b/i,
  /\bstart\s+["']/i,
  /\bsetsid\b/i,
];

export function stripBashBackgroundMarker(command: string): {
  command: string;
  marked: boolean;
} {
  const raw = String(command ?? "");
  if (!raw.includes("pi-desktop:background")) {
    return { command: raw, marked: false };
  }
  const stripped = raw
    .replace(/(?:^|\s)#\s*pi-desktop:background\s*$/im, "")
    .replace(/\s+$/g, "");
  return { command: stripped.length ? stripped : raw.trim(), marked: true };
}

/**
 * True when the command is expected to keep running (servers, watchers)
 * or the model opted into background via marker / shell backgrounding.
 */
export function commandShouldStartBackground(command: string): boolean {
  const { command: cleaned, marked } = stripBashBackgroundMarker(command);
  if (marked) return true;
  const text = cleaned.trim();
  if (!text) return false;
  if (DETACH_PATTERNS.some((re) => re.test(text))) return true;
  // Prefer matching the first pipeline / chain segment (ignore trailing pipes to less/etc.).
  const head = text.split(/(?:&&|\|\||;|\n)/)[0]?.trim() ?? text;
  return PERSISTENT_PATTERNS.some((re) => re.test(head) || re.test(text));
}

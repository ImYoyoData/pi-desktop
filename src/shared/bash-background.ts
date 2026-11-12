/**
 * Heuristics + markers so long-lived shell commands (dev servers, watchers)
 * detach into the Running panel instead of blocking the agent turn.
 */

/** 段首必须是启动器本身：否则 `grep next`、`cat vite.config.ts` 都会被误判成常驻进程。 */
const PERSISTENT_PATTERNS: RegExp[] = [
  /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve)\b/i,
  /^(?:(?:pnpm\s+exec|yarn\s+dlx|npx|pnpm|yarn|bunx)\s+(?:-\S+\s+)*)?(?:vite|nuxt|webpack-dev-server|http-server)\b(?![\s\S]*\bbuild\b)/i,
  /^(?:(?:pnpm\s+exec|yarn\s+dlx|npx|pnpm|yarn|bunx)\s+)?(?:next\s+dev|nodemon|serve)\b/i,
  /^docker\s+compose\s+up\b/i,
  /^docker-compose\s+up\b/i,
  /^(?:uvicorn|gunicorn|hypercorn)\b[^\n]*\b(--reload)?/i,
  /^flask\s+run\b/i,
  /^php\s+-S\b/i,
  /^rails\s+s(erver)?\b/i,
  /^cargo\s+watch\b/i,
  /^watchman\b/i,
  /^tail\b[^\n]*\s-f\b/i,
  /^python(\d+(\.\d+)?)?\s+-m\s+(http\.server|uvicorn)\b/i,
];

/** 只认命令末尾的注释形态：正文/引号里出现同一串字样不算显式转后台。 */
const MARKER_RE = /\s#\s*pi-desktop:background\s*$/i;

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
  const trimmed = raw.replace(/\s+$/g, "");
  const stripped = trimmed.replace(MARKER_RE, "").replace(/\s+$/g, "");
  const marked = stripped !== trimmed;
  return { command: marked && stripped.length ? stripped : raw, marked };
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
  // 逐段判定（`cd app && npm run dev` 的第二段才是启动器），段首锚定避免词内误伤。
  return splitSegments(text).some((segment) => segmentIsPersistent(segment, 1));
}

/**
 * 按 shell 分隔符切段，但跳过引号内部：
 * `git commit -m "fix; npm run dev"` 是一条命令，引号里的分隔符不算。
 */
function splitSegments(text: string): string[] {
  const out: string[] = [];
  let buffer = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quote) {
      buffer += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buffer += ch;
      continue;
    }
    if (ch === "\n" || ch === ";") {
      out.push(buffer);
      buffer = "";
      continue;
    }
    if ((ch === "&" || ch === "|") && text[i + 1] === ch) {
      out.push(buffer);
      buffer = "";
      i += 1;
      continue;
    }
    if (ch === "|") {
      out.push(buffer);
      buffer = "";
      continue;
    }
    buffer += ch;
  }
  out.push(buffer);
  return out.map((segment) => segment.trim()).filter(Boolean);
}

/** `sh -c "npm run dev"` / `bash -lc "..."`：真正要跑的是 -c 后面的字符串。 */
const SHELL_WRAP_RE =
  /^(?:sh|bash|zsh|dash|ksh|pwsh|powershell)(?:\.exe)?\b[^\n]*?\s-[A-Za-z]*c\s+(["'])([\s\S]*)\1\s*$/i;

/** 段首的环境变量赋值与启动器包装：`PORT=3000 npm run dev`、`env A=1 next dev`。 */
const LAUNCHER_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+|env\s+|exec\s+|command\s+)+/;

function segmentIsPersistent(segment: string, depth: number): boolean {
  const command = segment.replace(LAUNCHER_RE, "");
  if (PERSISTENT_PATTERNS.some((re) => re.test(command))) return true;
  if (depth <= 0) return false;
  const wrapped = SHELL_WRAP_RE.exec(command);
  if (!wrapped) return false;
  const inner = wrapped[2]!;
  return splitSegments(inner).some((part) => segmentIsPersistent(part, depth - 1));
}

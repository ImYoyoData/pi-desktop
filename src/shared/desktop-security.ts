export type SecurityMode = "ask" | "allow";
export type SecurityCategory = "bash" | "write";
export type PermissionDecision =
  | "allow_once"
  | "allow_once_background"
  | "allow_session_category"
  | "allow_whitelist"
  | "deny";

/** Worker → main RPC + main → renderer wait; long enough for interactive strip. */
export const PERMISSION_ASK_TIMEOUT_MS = 10 * 60 * 1000;

export const PERMISSION_DECISIONS: readonly PermissionDecision[] = [
  "allow_once",
  "allow_once_background",
  "allow_session_category",
  "allow_whitelist",
  "deny",
] as const;

export function isPermissionDecision(v: unknown): v is PermissionDecision {
  return (
    v === "allow_once" ||
    v === "allow_once_background" ||
    v === "allow_session_category" ||
    v === "allow_whitelist" ||
    v === "deny"
  );
}

/** Interactive strip prompt (main → renderer). */
export type PermissionAskPrompt = {
  sessionId: string;
  requestId: string;
  category: SecurityCategory;
  toolName: string;
  summary: string;
};

/** Main timed out / cleared the ask — renderer should dismiss the strip. */
export type PermissionAskCancelled = {
  sessionId: string;
  requestId: string;
  cancelled: true;
};

export type PermissionAskRequest = PermissionAskPrompt | PermissionAskCancelled;

export function isPermissionAskCancelled(
  req: PermissionAskRequest,
): req is PermissionAskCancelled {
  return "cancelled" in req && req.cancelled === true;
}

export type PermissionAskReply = {
  requestId: string;
  decision: PermissionDecision;
};

/** Per-workspace overrides for tool categories (global allowlist still applies). */
export type WorkspaceToolPermissions = {
  bash: SecurityMode;
  write: SecurityMode;
};

export type DesktopSecuritySettings = {
  /** Global defaults when a workspace has no override. */
  bash: SecurityMode;
  write: SecurityMode;
  bashAllowlist: string[];
  /**
   * Per-trusted-workspace tool modes, keyed by normalized absolute path.
   * Lookup walks ancestors (same idea as project trust).
   */
  workspacePermissions: Record<string, WorkspaceToolPermissions>;
};

export const DEFAULT_DESKTOP_SECURITY: DesktopSecuritySettings = {
  bash: "ask",
  write: "ask",
  bashAllowlist: [],
  workspacePermissions: {},
};

function asMode(v: unknown): SecurityMode {
  return v === "allow" || v === "ask" ? v : "ask";
}

function parseWorkspacePermissions(raw: unknown): Record<string, WorkspaceToolPermissions> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, WorkspaceToolPermissions> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const pathKey = key.trim();
    if (!pathKey || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    out[pathKey] = {
      bash: asMode(row.bash),
      write: asMode(row.write),
    };
  }
  return out;
}

export function parseDesktopSecurity(raw: unknown): DesktopSecuritySettings {
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ds =
    root.desktopSecurity && typeof root.desktopSecurity === "object"
      ? (root.desktopSecurity as Record<string, unknown>)
      : root;
  const list = Array.isArray(ds.bashAllowlist)
    ? ds.bashAllowlist.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  return {
    bash: asMode(ds.bash),
    write: asMode(ds.write),
    bashAllowlist: list.map((s) => s.trim()),
    workspacePermissions: parseWorkspacePermissions(ds.workspacePermissions),
  };
}

/** Normalize path keys so Win/macOS lookups stay stable (resolve + Win case-fold). */
export function normalizeSecurityPathKey(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  // Avoid importing node:path here — shared module is also used in renderer.
  let s = trimmed.replace(/\\/g, "/");
  // Collapse duplicate slashes except leading UNC //
  s = s.replace(/([^:])\/{2,}/g, "$1/");
  if (/^[A-Za-z]:\//.test(s)) {
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }
  // Windows paths are case-insensitive; fold for map keys.
  if (/^[A-Za-z]:\//.test(s) || s.startsWith("//")) {
    return s.toLowerCase();
  }
  return s;
}

function pathKeyEquals(a: string, b: string): boolean {
  return normalizeSecurityPathKey(a) === normalizeSecurityPathKey(b);
}

function parentPathKey(p: string): string | null {
  const n = normalizeSecurityPathKey(p);
  if (!n || n === "/") return null;
  // Windows drive root e.g. c:/
  if (/^[a-z]:\/$/i.test(n)) return null;
  const idx = n.lastIndexOf("/");
  if (idx <= 0) return null;
  if (/^[a-z]:\//i.test(n) && idx === 2) return n.slice(0, 3); // c:/
  return n.slice(0, idx) || null;
}

export function findWorkspacePermissions(
  settings: DesktopSecuritySettings,
  cwd: string | null | undefined,
): WorkspaceToolPermissions | null {
  if (!cwd?.trim()) return null;
  let current = cwd.trim();
  const map = settings.workspacePermissions;
  const entries = Object.entries(map);
  if (!entries.length) return null;

  while (current) {
    for (const [key, value] of entries) {
      if (pathKeyEquals(key, current)) return value;
    }
    const parent = parentPathKey(current);
    if (!parent || pathKeyEquals(parent, current)) break;
    current = parent;
  }
  return null;
}

/** Resolve effective bash/write modes for a workspace (override → global). */
export function resolveEffectiveSecurity(
  settings: DesktopSecuritySettings,
  cwd?: string | null,
): Pick<DesktopSecuritySettings, "bash" | "write" | "bashAllowlist"> {
  const override = findWorkspacePermissions(settings, cwd);
  return {
    bash: override?.bash ?? settings.bash,
    write: override?.write ?? settings.write,
    bashAllowlist: settings.bashAllowlist,
  };
}

export function bashAllowlistMatches(command: string, allowlist: string[]): boolean {
  const cmd = command.trim();
  if (!cmd) return false;
  return allowlist.some((entry) => {
    const e = entry.trim();
    return e.length > 0 && (cmd === e || cmd.startsWith(`${e} `) || cmd.startsWith(`${e}\t`));
  });
}

const COMPOUND_FIRST = new Set([
  "git",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "docker",
  "podman",
  "cargo",
  "go",
  "pip",
  "pip3",
  "poetry",
  "uv",
  "composer",
  "kubectl",
  "gh",
  "aws",
  "az",
  "gcloud",
  "dotnet",
  "swift",
  "flutter",
  "expo",
]);

/** Tokenize a shell fragment (handles simple quotes; good enough for allowlist stems). */
export function tokenizeShellFragment(input: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

/**
 * First top-level shell segment (split on && || ; | outside quotes).
 * For chained commands we prefer the *last* segment as the primary action.
 */
export function primaryShellSegment(command: string): string {
  const s = command.trim();
  if (!s) return "";
  const segments: string[] = [];
  let cur = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const next = s[i + 1];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === ";" || ch === "|") {
      if (cur.trim()) segments.push(cur.trim());
      cur = "";
      continue;
    }
    if (ch === "&" && next === "&") {
      if (cur.trim()) segments.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    if (ch === "|" && next === "|") {
      if (cur.trim()) segments.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) segments.push(cur.trim());
  return segments[segments.length - 1] ?? s;
}

/** Basename of an executable path (`/usr/bin/git` / `C:\\git\\cmd\\git.exe` → `git`). */
export function commandBasename(token: string): string {
  const normalized = token.replace(/\\/g, "/");
  const base = normalized.includes("/")
    ? normalized.slice(normalized.lastIndexOf("/") + 1)
    : normalized;
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, "");
}

/**
 * Normalize a bash command into a durable allowlist *prefix* (not the full line).
 * Examples:
 * - `git status --short` → `git status`
 * - `cd "x" && docker compose -f f.yml up` → `docker compose`
 * - `npm test --coverage` → `npm test`
 */
export function bashAllowlistEntryFromCommand(command: string): string {
  const segment = primaryShellSegment(command);
  const tokens = tokenizeShellFragment(segment);
  if (!tokens.length) return "";
  const first = commandBasename(tokens[0]!);
  if (!first) return "";
  const second = tokens[1];
  if (
    second &&
    !second.startsWith("-") &&
    COMPOUND_FIRST.has(first.toLowerCase())
  ) {
    return `${first} ${second}`;
  }
  return first;
}

export type PermissionEval =
  | { action: "allow"; reason: "mode_allow" | "allowlist" | "session" }
  | { action: "ask" }
  | { action: "deny"; reason: string };

export function evaluatePermission(input: {
  category: SecurityCategory;
  settings: DesktopSecuritySettings;
  command?: string;
  sessionAllows: Set<SecurityCategory>;
  /** When set, workspace-specific modes override global bash/write. */
  cwd?: string | null;
}): PermissionEval {
  const { category, settings, sessionAllows } = input;
  const effective = resolveEffectiveSecurity(settings, input.cwd);

  if (sessionAllows.has(category)) {
    return { action: "allow", reason: "session" };
  }

  if (effective[category] === "allow") {
    return { action: "allow", reason: "mode_allow" };
  }

  if (
    category === "bash" &&
    input.command !== undefined &&
    bashAllowlistMatches(input.command, effective.bashAllowlist)
  ) {
    return { action: "allow", reason: "allowlist" };
  }

  return { action: "ask" };
}

export function classifyToolName(toolName: string): SecurityCategory | null {
  const n = toolName.trim().toLowerCase();
  if (n === "bash") return "bash";
  if (n === "edit" || n === "write") return "write";
  return null;
}

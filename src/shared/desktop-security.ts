/**
 * 权限档位（全局唯一真源，设置面板与输入框选择器同源）。
 * - ask：一律询问，忽略其它放行机制
 * - edits：写文件自动放行，终端命令仍询问
 * - auto：编辑与命令自动放行，危险命令仍弹确认
 * - yolo：全部放行，不做任何检查
 */
export type PermissionProfile = "ask" | "edits" | "auto" | "yolo";

export type SecurityCategory = "bash" | "write";

export type PermissionDecision =
  | "allow_once"
  | "allow_once_background"
  | "allow_session_category"
  | "deny";

/** Worker → main RPC + main → renderer wait；够用户看清交互条。 */
export const PERMISSION_ASK_TIMEOUT_MS = 10 * 60 * 1000;

export const PERMISSION_PROFILES: readonly PermissionProfile[] = [
  "ask",
  "edits",
  "auto",
  "yolo",
] as const;

export const DEFAULT_PERMISSION_PROFILE: PermissionProfile = "ask";

export function isPermissionProfile(v: unknown): v is PermissionProfile {
  return v === "ask" || v === "edits" || v === "auto" || v === "yolo";
}

export function isPermissionDecision(v: unknown): v is PermissionDecision {
  return (
    v === "allow_once" ||
    v === "allow_once_background" ||
    v === "allow_session_category" ||
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
  /** Auto 档命中危险命令，弹窗需要给出警示。 */
  danger?: boolean;
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

export type DesktopSecuritySettings = {
  profile: PermissionProfile;
};

export const DEFAULT_DESKTOP_SECURITY: DesktopSecuritySettings = {
  profile: DEFAULT_PERMISSION_PROFILE,
};

function legacyMode(v: unknown): "ask" | "allow" {
  return v === "allow" ? "allow" : "ask";
}

/** 兼容旧设置文件：由 bash/write 两档推导档位。 */
function profileFromLegacy(ds: Record<string, unknown>): PermissionProfile {
  const bash = legacyMode(ds.bash);
  const write = legacyMode(ds.write);
  if (bash === "allow" && write === "allow") return "auto";
  if (bash === "ask" && write === "allow") return "edits";
  return "ask";
}

export function parseDesktopSecurity(raw: unknown): DesktopSecuritySettings {
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ds =
    root.desktopSecurity && typeof root.desktopSecurity === "object"
      ? (root.desktopSecurity as Record<string, unknown>)
      : root;
  if (isPermissionProfile(ds.profile)) return { profile: ds.profile };
  return { profile: profileFromLegacy(ds) };
}

/** Tokenize a shell fragment (handles simple quotes; good enough for detection). */
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
 * Last top-level shell segment (split on && || ; | outside quotes).
 * 链式命令取最后一段：那才是实际动作。
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

/** 破坏性系统命令：命中即视为危险。 */
const DANGEROUS_STEMS = new Set([
  "fdisk",
  "sfdisk",
  "diskpart",
  "format",
  "shutdown",
  "reboot",
  "poweroff",
  "halt",
]);

/** 根/家目录/盘根/通配这类"删了就完蛋"的目标。 */
const ROOT_LIKE_TARGET =
  /^(?:[/\\]|[/\\]\*|\*|\.\*|\.\.?|~[/\\]?|\$HOME[/\\]?\*?|\$\{HOME\}[/\\]?\*?|[A-Za-z]:[/\\]?\*?)$/;

const FORK_BOMB = /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/;

function hasRecursiveFlag(args: string[]): boolean {
  return args.some((a) => a === "--recursive" || /^-[a-zA-Z]*[rR]/.test(a));
}

/**
 * Auto 档仍会弹确认的危险命令检测（保守规则，宁可少拦也不误伤日常工作）。
 * 新增规则时保持同样的克制：只拦不可逆的系统级破坏。
 */
export function isDangerousBashCommand(command: string): boolean {
  const segment = primaryShellSegment(command);
  if (!segment) return false;
  const tokens = tokenizeShellFragment(segment);
  if (!tokens.length) return false;
  const stem = commandBasename(tokens[0]!).toLowerCase();
  const args = tokens.slice(1);

  if (DANGEROUS_STEMS.has(stem) || /^mkfs(\.|$)/.test(stem)) return true;
  if (stem === "dd" && args.some((a) => /^of=(?:\/dev\/|\\|\/\/)/i.test(a))) {
    return true;
  }
  if (
    (stem === "rm" || stem === "chmod" || stem === "chown") &&
    hasRecursiveFlag(args) &&
    args.some((a) => ROOT_LIKE_TARGET.test(a))
  ) {
    return true;
  }
  return FORK_BOMB.test(command);
}

export type PermissionEval =
  | { action: "allow"; reason: "profile" | "session" }
  | { action: "ask"; danger?: boolean }
  | { action: "deny"; reason: string };

export function evaluatePermission(input: {
  category: SecurityCategory;
  settings: DesktopSecuritySettings;
  command?: string;
  sessionAllows: Set<SecurityCategory>;
}): PermissionEval {
  const { category, settings, sessionAllows } = input;

  // 用户在本会话弹窗里显式点过"本会话允许"，优先级高于档位。
  if (sessionAllows.has(category)) {
    return { action: "allow", reason: "session" };
  }

  switch (settings.profile) {
    case "yolo":
      return { action: "allow", reason: "profile" };
    case "ask":
      return { action: "ask" };
    case "edits":
      return category === "write"
        ? { action: "allow", reason: "profile" }
        : { action: "ask" };
    case "auto": {
      if (category === "bash" && input.command && isDangerousBashCommand(input.command)) {
        return { action: "ask", danger: true };
      }
      return { action: "allow", reason: "profile" };
    }
    default: {
      const _exhaustive: never = settings.profile;
      return _exhaustive;
    }
  }
}

export function classifyToolName(toolName: string): SecurityCategory | null {
  const n = toolName.trim().toLowerCase();
  if (n === "bash") return "bash";
  if (n === "edit" || n === "write") return "write";
  return null;
}

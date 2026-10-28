/**
 * 工具调用审批（settings.json 的 desktopSecurity 段）。
 * - ask：命令与写文件都询问
 * - edits：写文件放行，命令仍询问
 * - auto：都放行，危险命令仍询问
 * - yolo：全部放行
 * auto 只拦不可逆的系统级破坏，规则保持保守。
 */

export type PermissionProfile = "ask" | "edits" | "auto" | "yolo";

export type PermissionCategory = "bash" | "write";

export type PermissionDecision =
	| "allow_once"
	| "allow_session_category"
	| "deny";

export const PERMISSION_PROFILES: readonly PermissionProfile[] = [
	"ask",
	"edits",
	"auto",
	"yolo",
];

export const DEFAULT_PERMISSION_PROFILE: PermissionProfile = "ask";

/** settings.json 里的段名；沿用旧版本的键名，老配置仍能读出。 */
export const PERMISSION_SETTINGS_KEY = "desktopSecurity";

export type PermissionSettings = {
	profile: PermissionProfile;
};

export const DEFAULT_PERMISSION_SETTINGS: PermissionSettings = {
	profile: DEFAULT_PERMISSION_PROFILE,
};

export function isPermissionProfile(value: unknown): value is PermissionProfile {
	return PERMISSION_PROFILES.includes(value as PermissionProfile);
}

export function isPermissionDecision(value: unknown): value is PermissionDecision {
	return (
		value === "allow_once" ||
		value === "allow_session_category" ||
		value === "deny"
	);
}

/** 解析整份 settings.json（或已取出的 desktopSecurity 段），非法值回落默认档。 */
export function parsePermissionSettings(raw: unknown): PermissionSettings {
	if (isPermissionProfile(raw)) return { profile: raw };
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return { ...DEFAULT_PERMISSION_SETTINGS };
	}
	const root = raw as Record<string, unknown>;
	const section = root[PERMISSION_SETTINGS_KEY];
	const source =
		section && typeof section === "object" && !Array.isArray(section)
			? (section as Record<string, unknown>)
			: root;
	return isPermissionProfile(source.profile)
		? { profile: source.profile }
		: { ...DEFAULT_PERMISSION_SETTINGS };
}

/** 写回 settings.json 的补丁。 */
export function permissionSettingsPatch(
	settings: PermissionSettings,
): Record<string, unknown> {
	return { [PERMISSION_SETTINGS_KEY]: { profile: settings.profile } };
}

/** 询问渲染层时的提示（main → renderer）。 */
export type PermissionAskPrompt = {
	sessionId: string;
	requestId: string;
	category: PermissionCategory;
	toolName: string;
	summary: string;
	danger?: boolean;
};

/** 询问被取消（超时 / Stop / 会话关闭）。 */
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

/** worker → main 的审批请求参数。 */
export type PermissionCheckParams = {
	toolName: string;
	summary: string;
	command?: string;
};

export type PermissionCheckResult =
	| { action: "allow" }
	| { action: "deny"; reason: string };

export function parsePermissionCheckParams(
	params: Record<string, unknown>,
): PermissionCheckParams | null {
	const toolName = typeof params.toolName === "string" ? params.toolName.trim() : "";
	if (!toolName) return null;
	const command =
		typeof params.command === "string" && params.command.trim()
			? params.command
			: undefined;
	const summary =
		typeof params.summary === "string" && params.summary.trim()
			? params.summary
			: (command ?? toolName);
	return { toolName, summary, ...(command ? { command } : {}) };
}

/** 写文件类工具：edit / write。 */
const WRITE_TOOLS = new Set(["edit", "write"]);
/** 命令类工具：bash / powershell。 */
const SHELL_TOOLS = new Set(["bash", "powershell"]);

export function classifyToolName(toolName: string): PermissionCategory | null {
	const name = toolName.trim().toLowerCase();
	if (SHELL_TOOLS.has(name)) return "bash";
	if (WRITE_TOOLS.has(name)) return "write";
	return null;
}

export type PermissionEval =
	| { action: "allow"; reason: "profile" | "session" }
	| { action: "ask"; danger?: boolean };

export function evaluatePermission(input: {
	category: PermissionCategory;
	profile: PermissionProfile;
	command?: string;
	sessionAllows: Set<PermissionCategory>;
}): PermissionEval {
	const { category, profile, sessionAllows } = input;

	if (sessionAllows.has(category)) return { action: "allow", reason: "session" };

	switch (profile) {
		case "yolo":
			return { action: "allow", reason: "profile" };
		case "ask":
			return { action: "ask" };
		case "edits":
			return category === "write"
				? { action: "allow", reason: "profile" }
				: { action: "ask" };
		case "auto":
			if (
				category === "bash" &&
				input.command &&
				isDangerousCommand(input.command)
			) {
				return { action: "ask", danger: true };
			}
			return { action: "allow", reason: "profile" };
		default:
			return { action: "ask" };
	}
}

/** 简单引号感知的分词，够用于危险命令识别。 */
function tokenize(input: string): string[] {
	const tokens: string[] = [];
	let cur = "";
	let quote: "'" | '"' | null = null;
	for (const ch of input) {
		if (quote) {
			if (ch === quote) quote = null;
			else cur += ch;
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

/** 链式命令取最后一段：那才是实际动作。 */
function lastShellSegment(command: string): string {
	const segments: string[] = [];
	let cur = "";
	let quote: "'" | '"' | null = null;
	for (let i = 0; i < command.length; i++) {
		const ch = command[i]!;
		const next = command[i + 1];
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
		const isBreak =
			ch === ";" ||
			ch === "|" ||
			ch === "&" ||
			ch === "\n" ||
			ch === "\r";
		if (isBreak) {
			if (cur.trim()) segments.push(cur.trim());
			cur = "";
			if ((ch === "&" || ch === "|") && next === ch) i++;
			continue;
		}
		cur += ch;
	}
	if (cur.trim()) segments.push(cur.trim());
	return segments[segments.length - 1] ?? command.trim();
}

function commandBasename(token: string): string {
	const normalized = token.replace(/\\/g, "/");
	const base = normalized.includes("/")
		? normalized.slice(normalized.lastIndexOf("/") + 1)
		: normalized;
	return base.replace(/\.(exe|cmd|bat|ps1)$/i, "");
}

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

const ROOT_LIKE_TARGET =
	/^(?:[/\\]|[/\\]\*|\*|\.\*|\.\.?|~[/\\]?|\$HOME[/\\]?\*?|\$\{HOME\}[/\\]?\*?|[A-Za-z]:[/\\]?\*?)$/;

const FORK_BOMB = /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/;

function hasRecursiveFlag(args: string[]): boolean {
	return args.some((a) => a === "--recursive" || /^-[a-zA-Z]*[rR]/.test(a));
}

/** 不可逆的系统级破坏命令。 */
export function isDangerousCommand(command: string): boolean {
	const segment = lastShellSegment(command);
	if (!segment) return false;
	const tokens = tokenize(segment);
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

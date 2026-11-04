/** Desktop slash-command catalog (builtins, skills, and file commands). */

import ompCommands from "./omp-slash-commands.json";
import piCommands from "./pi-slash-commands.json";

/** 生成自 omp SDK 的命令元数据（scripts/gen-omp-slash-commands.bun.mjs）。 */
export type OmpSlashCommand = {
  name: string;
  aliases: string[];
  description: string;
  hint: string | null;
  subcommands: { name: string; description: string }[];
  /** 有 ACP handle，非终端宿主也能执行。 */
  handles: boolean;
  /** builtin 由 worker 分发；custom 交给 AgentSession 展开。 */
  source: "builtin" | "custom";
};

export const OMP_SLASH_COMMANDS = ompCommands as OmpSlashCommand[];

const OMP_COMMAND_BY_NAME = new Map<string, OmpSlashCommand>();
for (const command of OMP_SLASH_COMMANDS) {
  OMP_COMMAND_BY_NAME.set(command.name, command);
  for (const alias of command.aliases) {
    if (!OMP_COMMAND_BY_NAME.has(alias)) OMP_COMMAND_BY_NAME.set(alias, command);
  }
}

export function findOmpSlashCommand(name: string): OmpSlashCommand | undefined {
  return OMP_COMMAND_BY_NAME.get(name);
}

export function isOmpSlashCommand(name: string): boolean {
  return OMP_COMMAND_BY_NAME.has(name);
}

/** 生成自 pi SDK 的内建命令元数据（scripts/gen-pi-slash-commands.bun.mjs）。 */
export type PiSlashCommand = {
  name: string;
  description: string;
  hint: string | null;
};

export const PI_SLASH_COMMANDS = piCommands as PiSlashCommand[];

const PI_COMMAND_BY_NAME = new Map<string, PiSlashCommand>();
for (const command of PI_SLASH_COMMANDS) PI_COMMAND_BY_NAME.set(command.name, command);

export function findPiSlashCommand(name: string): PiSlashCommand | undefined {
  return PI_COMMAND_BY_NAME.get(name);
}

export type SlashItemKind = "builtin" | "skill" | "command" | "action" | "omp" | "pi";

export type SlashItem = {
  id: string;
  kind: SlashItemKind;
  /** Command text without leading `/`, e.g. `compact` or `skill:foo`. */
  command: string;
  title: string;
  description: string;
};

/** 文件型斜杠命令：来自 .claude/commands 或 .opencode/commands。 */
export type ExternalSlashCommand = {
  name: string;
  description: string;
  argumentHint?: string;
  content: string;
  source:
    | "claude-user"
    | "claude-project"
    | "opencode-user"
    | "opencode-project";
  filePath: string;
};

export type SlashCatalog = {
  /** skills.enableSkillCommands：技能是否注册为 `/skill:name`。 */
  skillCommands: boolean;
  commands: ExternalSlashCommand[];
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
  const lineStart = draft.lastIndexOf("\n") + 1;
  const line = draft.slice(lineStart);
  // 引用标签在草稿里序列化为前导空格，行首空白不应吞掉 `/`。
  const lead = line.length - line.trimStart().length;
  if (line[lead] !== "/") return null;
  const body = line.slice(lead + 1);
  // `/skill:name args` → leave menu once args begin (space after token).
  if (/\s/.test(body)) return null;
  return { query: body, slashIndex: lineStart + lead, line: line.slice(lead) };
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

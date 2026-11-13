import type { AgentBackend } from "../../../../shared/agent-backend";
import {
  findOmpSlashCommand,
  findPiSlashCommand,
  isSlashBuiltinId,
  type SlashBuiltinId,
} from "../../../../shared/slash-commands";

/** 会改动会话、文件或账户状态，执行前需要确认。 */
export const DANGEROUS_OMP_COMMANDS: Record<string, true> = {
  marketplace: true,
  install: true,
  uninstall: true,
  upgrade: true,
  update: true,
  login: true,
  logout: true,
  quit: true,
  exit: true,
  delete: true,
  cleanse: true,
  reset: true,
  remove: true,
  "remove-dir": true,
  "forget-approvals": true,
  restart: true,
  kill: true,
  stop: true,
  move: true,
  shake: true,
};

/** 整个草稿只有一个内置斜杠命令时返回它。 */
export function bareBuiltinSlashDraft(draft: string): SlashBuiltinId | null {
  const raw = draft.trim();
  if (!raw.startsWith("/") || raw.includes("\n")) return null;
  const body = raw.slice(1).trim();
  return isSlashBuiltinId(body) ? body : null;
}

/** 草稿是 omp 内建命令时返回归一化命令名（别名按主名）。 */
export function bareOmpCommandDraft(
  draft: string,
  backend: AgentBackend,
): string | null {
  if (backend !== "omp") return null;
  const raw = draft.trim();
  if (!raw.startsWith("/") || raw.includes("\n")) return null;
  const name = raw.slice(1).split(/\s+/, 1)[0] ?? "";
  const command = findOmpSlashCommand(name)?.name;
  if (!command || isSlashBuiltinId(command)) return null;
  return command;
}

/** 草稿是 pi 内建命令时返回命令名。 */
export function barePiCommandDraft(
  draft: string,
  backend: AgentBackend,
): string | null {
  if (backend !== "pi") return null;
  const raw = draft.trim();
  if (!raw.startsWith("/") || raw.includes("\n")) return null;
  const name = raw.slice(1).split(/\s+/, 1)[0] ?? "";
  return findPiSlashCommand(name)?.name ?? null;
}

/** 运行中的 `/skill:name` 也要即时 steer，不能进入发送队列。 */
export function bareSkillCommandDraft(draft: string): boolean {
  const raw = draft.trim();
  return raw.startsWith("/skill:") && !raw.includes("\n");
}

/** `/settings`、`/setup`（含 providers 别名）只打开桌面设置页。 */
export function bareOmpClientSlashDraft(
  draft: string,
  backend: AgentBackend,
): "settings" | "setup" | null {
  const command = bareOmpCommandDraft(draft, backend);
  return command === "settings" || command === "setup" ? command : null;
}

/**
 * 用户消息开头被注入的块：思考语言块（现行）与旧版模式标记块（历史遗留）。
 * 模式功能下线后不再注入新块，但历史会话仍带旧标记，展示前需剥离。
 */

import { stripThinkingLanguageBlock } from "./thinking-language";

const LEGACY_MODE_MARKER_PREFIX = "[pi-desktop mode:";

/** 旧版模式标签种类；历史会话的附件标签里可能残留。 */
export type LegacyModeTagKind = "agent" | "ask" | "plan" | "task";

const LEGACY_MODE_TAG_KINDS: readonly LegacyModeTagKind[] = [
  "agent",
  "ask",
  "plan",
  "task",
];

export function isLegacyModeTagKind(kind: string | undefined): kind is LegacyModeTagKind {
  return kind !== undefined && LEGACY_MODE_TAG_KINDS.includes(kind as LegacyModeTagKind);
}

/** 剥离开头注入的块，只留用户正文。 */
export function stripInjectedBlocks(text: string): string {
  const raw = stripThinkingLanguageBlock(text ?? "");
  if (!raw.startsWith(LEGACY_MODE_MARKER_PREFIX)) return raw;
  const sep = raw.indexOf("\n\n");
  if (sep < 0) return "";
  return raw.slice(sep + 2);
}

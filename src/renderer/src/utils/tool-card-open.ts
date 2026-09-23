/**
 * When a tool card opens by itself.
 *
 * Pulled out of the component as pure functions because this rule caused real
 * confusion: cards kept auto-expanding and burying the answer, and the detail
 * rows inside a grouped work-section expanded on top of the group summary.
 */

import type { ToolCard } from "./tool-diff";

export type ToolCardOpenInput = {
  kind: ToolCard["kind"];
  /** The user's "展开工具调用详情" setting. */
  expandToolCalls: boolean;
  /** Card is a detail row inside a grouped work-section (Copilot tree item). */
  detailCollapsed: boolean;
  /** The turn finished (or the row is otherwise settled). */
  autoCollapse: boolean;
  /** The card is still streaming output. */
  streaming: boolean;
  /** Explicit user toggle; null = no manual choice yet. */
  manuallyOpen: boolean | null;
};

/**
 * Kind families that may auto-expand when the setting is on. `read` stays folded
 * even then: a read produces a large file dump that nobody wants inline.
 */
export function toolCardAutoExpandAllowed(kind: ToolCard["kind"]): boolean {
  switch (kind) {
    case "write":
    case "edit":
    case "bash":
    case "todo":
      return true;
    case "read":
    case "generic":
    case "other":
      return false;
    default: {
      const _never: never = kind;
      return Boolean(_never);
    }
  }
}

/**
 * Resolve whether a card renders expanded.
 *
 * Order matters:
 * 1. A settled card follows only an explicit user choice — history stays folded.
 * 2. A manual toggle always wins.
 * 3. Detail rows inside a work-section never auto-expand: the group header is the
 *    summary ("已读取 2 个文件 · 已运行 1 条命令"), so unfolding every row as well
 *    would bury the answer.
 * 4. Otherwise the setting decides, per kind.
 */
export function isToolCardOpen(input: ToolCardOpenInput): boolean {
  if (input.autoCollapse) return input.manuallyOpen === true;
  if (input.manuallyOpen !== null) return input.manuallyOpen;
  if (input.detailCollapsed) return false;
  if (!input.expandToolCalls) return false;
  if (!toolCardAutoExpandAllowed(input.kind)) return false;
  // A finished step stays open until the whole turn finishes, so the result
  // (diff / output) can keep streaming in instead of folding after 1.2s.
  return Boolean(input.streaming);
}

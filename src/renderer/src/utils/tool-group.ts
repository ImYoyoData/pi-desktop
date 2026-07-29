import { isReadTool } from "./tool-diff";

export type ToolActivityCounts = {
  read: number;
  /** Non-read tools (bash, edit, MCP, …) — shown as “调用工具”. */
  tool: number;
};

export type ToolGroupable = {
  id: string;
  role: string;
  toolName: string;
};

export type ToolGroupSpan = {
  /** Stable id for the group (lead tool message id). */
  groupId: string;
  /** Inclusive start index in the message list. */
  start: number;
  /** Exclusive end index. */
  end: number;
  /** Message ids in this group. */
  ids: string[];
};

/**
 * Build spans of consecutive groupable tool messages (length >= 2).
 * Non-groupable tools (e.g. ask_user) break the streak and stay standalone.
 */
export function buildToolGroupSpans(
  messages: ToolGroupable[],
  isGroupable: (msg: ToolGroupable) => boolean,
): ToolGroupSpan[] {
  const spans: ToolGroupSpan[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i]!;
    if (msg.role !== "tool" || !isGroupable(msg)) {
      i += 1;
      continue;
    }
    const start = i;
    const ids: string[] = [];
    while (i < messages.length) {
      const cur = messages[i]!;
      if (cur.role !== "tool" || !isGroupable(cur)) break;
      ids.push(cur.id);
      i += 1;
    }
    if (ids.length >= 2) {
      spans.push({
        groupId: `tg:${ids[0]}`,
        start,
        end: i,
        ids,
      });
    }
  }
  return spans;
}

export function countToolActivities(
  tools: Array<{ toolName: string }>,
): ToolActivityCounts {
  let read = 0;
  let tool = 0;
  for (const item of tools) {
    if (isReadTool(item.toolName)) read += 1;
    else tool += 1;
  }
  return { read, tool };
}

export type ToolGroupSummaryParts = {
  readTimes: (n: number) => string;
  toolTimes: (n: number) => string;
  join: (parts: string[]) => string;
};

/** Cursor-style one-line summary, e.g. "调用工具2次、读取文件4次". */
export function formatToolGroupSummary(
  counts: ToolActivityCounts,
  parts: ToolGroupSummaryParts,
): string {
  const chunks: string[] = [];
  if (counts.tool > 0) chunks.push(parts.toolTimes(counts.tool));
  if (counts.read > 0) chunks.push(parts.readTimes(counts.read));
  if (chunks.length === 0) chunks.push(parts.toolTimes(0));
  return parts.join(chunks);
}

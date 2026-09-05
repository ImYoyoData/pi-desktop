import {
  isBashTool,
  isFileMutationTool,
  isReadTool,
  toolCommandFromArgs,
  toolPathFromArgs,
} from "./tool-diff";
import { isTodoToolName } from "./session-todos";

/**
 * VS Code Copilot work-section model (chatThinkingContentPart): every step of
 * the agent's process between two answer text blocks — all tool calls plus
 * thinking notes — folds into ONE collapsible section, each step a separate
 * row. Answer text breaks the section; a lone tool call with nothing else
 * stays a standalone row (single-item sections are unwrapped).
 */
export type WorkSectionRow = {
  id: string;
  role: string;
  /** "" for non-tool rows. */
  toolName: string;
  /** Assistant rows: visible answer text. */
  hasText: boolean;
  /** Assistant rows: thinking content. */
  hasThinking: boolean;
};

export type WorkSectionSpan = {
  /** Stable id for the section (lead row id). */
  groupId: string;
  /** Inclusive start index in the message list. */
  start: number;
  /** Exclusive end index. */
  end: number;
  /** Message ids in this section (tools + thinking rows, in order). */
  ids: string[];
};

function isProcessRow(
  row: WorkSectionRow,
  isStandaloneTool: (row: WorkSectionRow) => boolean,
): boolean {
  if (row.role === "tool") return !isStandaloneTool(row);
  return row.role === "assistant" && row.hasThinking && !row.hasText;
}

/**
 * Build spans of consecutive process rows. A span qualifies when it holds at
 * least one tool call and two rows overall; interactive tools (ask_user) and
 * answer text break the streak.
 */
export function buildWorkSectionSpans(
  rows: WorkSectionRow[],
  isStandaloneTool: (row: WorkSectionRow) => boolean,
): WorkSectionSpan[] {
  const spans: WorkSectionSpan[] = [];
  let i = 0;
  while (i < rows.length) {
    if (!isProcessRow(rows[i]!, isStandaloneTool)) {
      i += 1;
      continue;
    }
    const start = i;
    const ids: string[] = [];
    let tools = 0;
    while (i < rows.length && isProcessRow(rows[i]!, isStandaloneTool)) {
      if (rows[i]!.role === "tool") tools += 1;
      ids.push(rows[i]!.id);
      i += 1;
    }
    if (tools >= 1 && ids.length >= 2) {
      spans.push({
        groupId: `ws:${ids[0]}`,
        start,
        end: i,
        ids,
      });
    }
  }
  return spans;
}

export type WorkSectionToolKind = "edit" | "read" | "bash" | "todo" | "tool";

export type WorkSectionTool = {
  kind: WorkSectionToolKind;
  /** File basename / command / tool name used for label building. */
  target: string;
};

function basename(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Classify one tool call for section titles (Copilot icon/label families). */
export function categorizeToolCall(
  toolName: string,
  args: unknown,
): WorkSectionTool {
  if (isFileMutationTool(toolName)) {
    const path = toolPathFromArgs(args);
    return { kind: "edit", target: path ? basename(path) : toolName };
  }
  if (isReadTool(toolName)) {
    const path = toolPathFromArgs(args);
    return { kind: "read", target: path ? basename(path) : toolName };
  }
  if (isBashTool(toolName)) {
    const command = toolCommandFromArgs(args);
    return { kind: "bash", target: command ? truncate(command, 48) : toolName };
  }
  if (isTodoToolName(toolName)) {
    return { kind: "todo", target: "" };
  }
  return { kind: "tool", target: toolName };
}

/** i18n strings for the finalized (past-tense) section title. */
export type WorkSectionSummaryStrings = {
  editOne: (file: string) => string;
  editMany: (count: number) => string;
  readOne: (file: string) => string;
  readMany: (count: number) => string;
  /** Same file read and edited, e.g. "Reviewed and updated foo.ts". */
  readAndEdited: (file: string) => string;
  bash: (count: number) => string;
  todo: string;
  tool: (name: string) => string;
  steps: (count: number) => string;
  join: (parts: string[]) => string;
};

/**
 * Deterministic past-tense title, following the rules VS Code gives its
 * title-generating model: past-tense verb first, real filename for a single
 * file, "N files" for multiples, read+edit of the same file combined.
 */
export function summarizeWorkSection(
  tools: WorkSectionTool[],
  thinkingCount: number,
  s: WorkSectionSummaryStrings,
): string {
  const edits = new Set<string>();
  const reads = new Set<string>();
  let bash = 0;
  let todo = false;
  const generic: string[] = [];
  for (const tool of tools) {
    switch (tool.kind) {
      case "edit":
        edits.add(tool.target);
        break;
      case "read":
        reads.add(tool.target);
        break;
      case "bash":
        bash += 1;
        break;
      case "todo":
        todo = true;
        break;
      default:
        if (!generic.includes(tool.target)) generic.push(tool.target);
    }
  }
  const parts: string[] = [];
  const overlap = [...reads].filter((f) => edits.has(f));
  if (edits.size === 1 && reads.size === 1 && overlap.length === 1) {
    parts.push(s.readAndEdited(overlap[0]!));
  } else {
    for (const f of overlap) reads.delete(f);
    if (edits.size === 1) parts.push(s.editOne([...edits][0]!));
    else if (edits.size > 1) parts.push(s.editMany(edits.size));
    if (reads.size === 1) parts.push(s.readOne([...reads][0]!));
    else if (reads.size > 1) parts.push(s.readMany(reads.size));
  }
  if (bash > 0) parts.push(s.bash(bash));
  if (todo) parts.push(s.todo);
  for (const name of generic.slice(0, Math.max(0, 3 - parts.length))) {
    parts.push(s.tool(name));
  }
  if (parts.length === 0) return s.steps(tools.length + thinkingCount);
  return s.join(parts.slice(0, 3));
}

/** i18n strings for the live (present-tense) section title while streaming. */
export type WorkSectionLiveStrings = {
  edit: (file: string) => string;
  read: (file: string) => string;
  bash: (command: string) => string;
  todo: string;
  tool: (name: string) => string;
  thinking: string;
};

/** Present-tense label of the latest step, shown as the title mid-stream. */
export function workSectionLiveTitle(
  tools: WorkSectionTool[],
  s: WorkSectionLiveStrings,
): string {
  const last = tools[tools.length - 1];
  if (!last) return s.thinking;
  switch (last.kind) {
    case "edit":
      return s.edit(last.target);
    case "read":
      return s.read(last.target);
    case "bash":
      return s.bash(last.target);
    case "todo":
      return s.todo;
    default:
      return s.tool(last.target);
  }
}

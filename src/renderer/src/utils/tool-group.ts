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

/**
 * Ids of assistant rows that are the FINAL answer of their user round — the
 * last visible assistant text before the next user message (or the end of the
 * list). Only these carry copy / speak / regenerate actions.
 *
 * Pi emits one assistant message per model step inside a single user round, so
 * mid-round narration ("I'll check the folder first…" + toolCall) would
 * otherwise render as a finished turn with actions while the round is still
 * running. Following VS Code Copilot, per-round tool narration stays a process
 * row; the actions belong to the round's closing answer only.
 */
export function finalAnswerRowIds(rows: WorkSectionRow[]): Set<string> {
  const out = new Set<string>();
  let lastTextId: string | null = null;
  for (const row of rows) {
    if (row.role === "user") {
      if (lastTextId != null) out.add(lastTextId);
      lastTextId = null;
    } else if (row.role === "assistant" && row.hasText) {
      lastTextId = row.id;
    }
  }
  if (lastTextId != null) out.add(lastTextId);
  return out;
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
  steps: (count: number) => string;
};

/**
 * Finalized past-tense title, matching Copilot's `finalizeTitleIfDefault`:
 * - The same file read and edited → "Reviewed and updated <file>".
 * - A single named file → "<verb> <file>".
 * - Multiple named files → "<verb> N files" (never "1 file" phrasing).
 * - Otherwise (commands, todos, generic tools, thinking only) →
 *   "Finished with N steps" (Copilot's setFallbackTitle).
 */
export function summarizeWorkSection(
  tools: WorkSectionTool[],
  thinkingCount: number,
  s: WorkSectionSummaryStrings,
): string {
  const edits = new Set<string>();
  const reads = new Set<string>();
  for (const tool of tools) {
    if (tool.kind === "edit") edits.add(tool.target);
    else if (tool.kind === "read") reads.add(tool.target);
  }
  const overlap = [...reads].filter((f) => edits.has(f));
  if (edits.size === 1 && reads.size === 1 && overlap.length === 1) {
    return s.readAndEdited(overlap[0]!);
  }
  if (edits.size === 1) return s.editOne([...edits][0]!);
  if (edits.size > 1) return s.editMany(edits.size);
  for (const f of overlap) reads.delete(f);
  if (reads.size === 1) return s.readOne([...reads][0]!);
  if (reads.size > 1) return s.readMany(reads.size);
  return s.steps(tools.length + thinkingCount);
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

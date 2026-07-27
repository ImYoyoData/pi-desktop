/** Parse Pi coding-agent tool payloads for Cursor-like file-edit cards. */

export type ToolDiffStats = {
  additions: number;
  deletions: number;
};

export type FileToolCard = {
  kind: "edit" | "write" | "other";
  path: string | null;
  stats: ToolDiffStats | null;
  /** Display-oriented diff from EditToolDetails, or synthesized preview. */
  diff: string | null;
  /** Unified patch when available. */
  patch: string | null;
  firstChangedLine?: number;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/** Count +/- lines in a unified / display diff (ignore +++ / --- headers). */
export function countDiffStats(diffText: string): ToolDiffStats {
  let additions = 0;
  let deletions = 0;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) {
      continue;
    }
    // Display diff: "+123 content" / "-123 content" / " 123 content"
    if (/^\+\s*\d*\s/.test(line) || (line.startsWith("+") && !line.startsWith("+++"))) {
      additions += 1;
      continue;
    }
    if (/^-\s*\d*\s/.test(line) || (line.startsWith("-") && !line.startsWith("---"))) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

function extractToolResult(result: unknown): {
  details: Record<string, unknown> | null;
  text: string;
} {
  if (!isRecord(result)) {
    return { details: null, text: result == null ? "" : String(result) };
  }
  // AgentToolResult shape: { content, details }
  const details = isRecord(result.details) ? result.details : null;
  let text = "";
  if (Array.isArray(result.content)) {
    text = result.content
      .map((c) => (isRecord(c) && typeof c.text === "string" ? c.text : ""))
      .filter(Boolean)
      .join("\n");
  } else if (typeof result.content === "string") {
    text = result.content;
  }
  // Some paths may put diff at top level
  if (!details && (typeof result.diff === "string" || typeof result.patch === "string")) {
    return { details: result, text };
  }
  return { details, text };
}

function pathFromArgs(args: unknown): string | null {
  if (!isRecord(args)) return null;
  const p = args.path ?? args.file_path ?? args.filePath;
  return typeof p === "string" && p.trim() ? p.trim() : null;
}

function previewWriteContent(content: string, maxLines = 40): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const slice = lines.slice(0, maxLines);
  const body = slice.map((l, i) => `+${String(i + 1).padStart(4)} ${l}`).join("\n");
  if (lines.length > maxLines) {
    return `${body}\n     … (${lines.length - maxLines} more lines)`;
  }
  return body;
}

export function parseFileToolCard(
  toolName: string,
  args: unknown,
  result: unknown,
): FileToolCard {
  const name = toolName.toLowerCase();
  const path = pathFromArgs(args);
  const { details } = extractToolResult(result);

  if (name === "edit" || name === "str_replace" || name === "search_replace") {
    const diff = typeof details?.diff === "string" ? details.diff : null;
    const patch = typeof details?.patch === "string" ? details.patch : null;
    const source = diff || patch || "";
    const stats = source ? countDiffStats(source) : null;
    const firstChangedLine =
      typeof details?.firstChangedLine === "number" ? details.firstChangedLine : undefined;
    return {
      kind: "edit",
      path,
      stats,
      diff: diff || patch,
      patch,
      firstChangedLine,
    };
  }

  if (name === "write" || name === "write_file" || name === "create_file") {
    const content =
      isRecord(args) && typeof args.content === "string" ? args.content : "";
    const lineCount = content ? content.replace(/\r\n/g, "\n").split("\n").length : 0;
    return {
      kind: "write",
      path,
      stats: content ? { additions: lineCount, deletions: 0 } : null,
      diff: content ? previewWriteContent(content) : null,
      patch: null,
    };
  }

  return {
    kind: "other",
    path,
    stats: null,
    diff: null,
    patch: null,
  };
}

export function isFileMutationTool(toolName: string): boolean {
  const n = toolName.toLowerCase();
  return n === "edit" || n === "write" || n === "str_replace" || n === "search_replace" || n === "write_file";
}

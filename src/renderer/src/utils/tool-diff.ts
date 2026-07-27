/** Parse Pi coding-agent tool payloads for Cursor-like tool cards. */

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

export type ReadToolCard = {
  kind: "read";
  path: string | null;
  /** Lines returned to the model (after offset/limit/truncation). */
  linesRead: number | null;
  /** Total lines in the file when known. */
  totalLines: number | null;
  /** 1-based start line when offset was used. */
  startLine: number | null;
  truncated: boolean;
  preview: string | null;
};

export type BashToolCard = {
  kind: "bash";
  command: string | null;
  linesRead: number | null;
  totalLines: number | null;
  truncated: boolean;
  preview: string | null;
};

export type GenericToolCard = {
  kind: "generic";
  summary: string | null;
  preview: string | null;
};

export type ToolCard = FileToolCard | ReadToolCard | BashToolCard | GenericToolCard;

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

export function extractToolResult(result: unknown): {
  details: Record<string, unknown> | null;
  text: string;
} {
  if (!isRecord(result)) {
    return { details: null, text: result == null ? "" : String(result) };
  }
  const details = isRecord(result.details) ? result.details : null;
  let text = "";
  if (Array.isArray(result.content)) {
    text = result.content
      .map((c) => (isRecord(c) && typeof c.text === "string" ? c.text : ""))
      .filter(Boolean)
      .join("\n");
  } else if (typeof result.content === "string") {
    text = result.content;
  } else if (typeof result.text === "string") {
    text = result.text;
  }
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

function commandFromArgs(args: unknown): string | null {
  if (!isRecord(args)) return null;
  const c = args.command ?? args.cmd;
  return typeof c === "string" && c.trim() ? c.trim() : null;
}

function truncationFromDetails(details: Record<string, unknown> | null): {
  linesRead: number | null;
  totalLines: number | null;
  truncated: boolean;
} {
  const trunc = details && isRecord(details.truncation) ? details.truncation : null;
  if (!trunc) {
    return { linesRead: null, totalLines: null, truncated: false };
  }
  return {
    linesRead: typeof trunc.outputLines === "number" ? trunc.outputLines : null,
    totalLines: typeof trunc.totalLines === "number" ? trunc.totalLines : null,
    truncated: trunc.truncated === true,
  };
}

function countTextLines(text: string): number {
  if (!text) return 0;
  return text.replace(/\r\n/g, "\n").split("\n").length;
}

function previewText(text: string, maxLines = 24): string | null {
  if (!text.trim()) return null;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.length <= maxLines) return text;
  return `${lines.slice(0, maxLines).join("\n")}\n… (${lines.length - maxLines} more)`;
}

/** Parse "Showing lines A-B of N" notices from read/bash tool text. */
function parseLineRangeNotice(text: string): {
  startLine: number | null;
  linesRead: number | null;
  totalLines: number | null;
} {
  const m = text.match(/Showing lines\s+(\d+)-(\d+)\s+of\s+(\d+)/i);
  if (m) {
    const start = Number(m[1]);
    const end = Number(m[2]);
    const total = Number(m[3]);
    return {
      startLine: start,
      linesRead: end - start + 1,
      totalLines: total,
    };
  }
  const m2 = text.match(/of\s+(\d+)\s+lines\s+total/i);
  if (m2) {
    return { startLine: null, linesRead: null, totalLines: Number(m2[1]) };
  }
  return { startLine: null, linesRead: null, totalLines: null };
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

export function parseReadToolCard(args: unknown, result: unknown): ReadToolCard {
  const path = pathFromArgs(args);
  const { details, text } = extractToolResult(result);
  const trunc = truncationFromDetails(details);
  const notice = parseLineRangeNotice(text);
  const offset =
    isRecord(args) && typeof args.offset === "number" ? Math.max(1, args.offset) : null;
  const limit =
    isRecord(args) && typeof args.limit === "number" ? Math.max(0, args.limit) : null;

  let linesRead = trunc.linesRead ?? notice.linesRead;
  let totalLines = trunc.totalLines ?? notice.totalLines;
  if (linesRead == null && text) {
    // Strip trailing truncation notices before counting
    const body = text.replace(/\n\n\[Showing lines[\s\S]*$/i, "").replace(/\n\n\[\d+ more lines[\s\S]*$/i, "");
    linesRead = countTextLines(body);
  }
  if (linesRead == null && limit != null) linesRead = limit;
  if (totalLines == null && linesRead != null && !trunc.truncated && limit == null && offset == null) {
    totalLines = linesRead;
  }

  return {
    kind: "read",
    path,
    linesRead,
    totalLines,
    startLine: notice.startLine ?? offset,
    truncated: trunc.truncated,
    preview: previewText(text),
  };
}

export function parseBashToolCard(args: unknown, result: unknown): BashToolCard {
  const { details, text } = extractToolResult(result);
  const trunc = truncationFromDetails(details);
  const notice = parseLineRangeNotice(text);
  let linesRead = trunc.linesRead ?? notice.linesRead;
  if (linesRead == null && text) linesRead = countTextLines(text);
  return {
    kind: "bash",
    command: commandFromArgs(args),
    linesRead,
    totalLines: trunc.totalLines ?? notice.totalLines,
    truncated: trunc.truncated,
    preview: previewText(text),
  };
}

export function parseToolCard(
  toolName: string,
  args: unknown,
  result: unknown,
): ToolCard {
  const name = toolName.toLowerCase();
  if (isFileMutationTool(name)) {
    return parseFileToolCard(toolName, args, result);
  }
  if (name === "read" || name === "read_file") {
    return parseReadToolCard(args, result);
  }
  if (name === "bash" || name === "shell" || name === "execute" || name === "run") {
    return parseBashToolCard(args, result);
  }
  const { text } = extractToolResult(result);
  const summary =
    commandFromArgs(args) ??
    pathFromArgs(args) ??
    (isRecord(args) ? JSON.stringify(args).slice(0, 120) : null);
  return {
    kind: "generic",
    summary,
    preview: previewText(text || (args != null ? JSON.stringify(args, null, 2) : "")),
  };
}

export function isFileMutationTool(toolName: string): boolean {
  const n = toolName.toLowerCase();
  return (
    n === "edit" ||
    n === "write" ||
    n === "str_replace" ||
    n === "search_replace" ||
    n === "write_file" ||
    n === "create_file"
  );
}

export function isReadTool(toolName: string): boolean {
  const n = toolName.toLowerCase();
  return n === "read" || n === "read_file";
}

export function isBashTool(toolName: string): boolean {
  const n = toolName.toLowerCase();
  return n === "bash" || n === "shell" || n === "execute" || n === "run";
}

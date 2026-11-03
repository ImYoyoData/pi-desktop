/** 文件搜索与 AST 改写工具的详情卡。 */

import { pathListFromOutput, splitTrailingNotice } from "./structured-text";
import {
  arrayValue,
  buildCard,
  firstLine,
  numberValue,
  record,
  textSection,
  textValue,
} from "./tool-detail-shared";
import type {
  DetailChip,
  DetailMatchFile,
  DetailParseOptions,
  DetailResultParts,
  DetailSection,
  DetailToolCard,
} from "./tool-detail-types";

const FILE_HEADER_RE = /^#+\s+(.+?)(?:\s+\((\d+) match(?:es)?\))?\s*$/;
const EDIT_HEADER_RE = /^#+\s+(.+?)(?:\s+\(\d+\s+replacement(?:s)?\))?\s*$/;
const MATCH_LINE_RE = /^\s*([*+\-])?\s*(\d+)│(.*)$/;
const EDIT_LINE_RE = /^\s*([+\-])\s*(\d+)│(.*)$/;

function cleanHeaderPath(raw: string): string {
  return raw
    .trim()
    .replace(/\s+\(\d+\s+match(?:es)?\)$/i, "")
    .replace(/\s+\(\d+\s+replacement(?:s)?\)$/i, "")
    .replace(/#[A-Za-z0-9_-]+$/, "")
    .trim();
}

function headerDepth(line: string): number {
  return /^#+/.exec(line)?.[0].length ?? 0;
}

function setDirectory(dirs: string[], depth: number, name: string): void {
  dirs[depth - 1] = name;
  dirs.length = depth;
}

function filePathAt(dirs: string[], depth: number, name: string): string {
  return `${dirs.slice(0, Math.max(0, depth - 1)).join("")}${name}`;
}

function parseMatchGroups(text: string, fallbackPath: string | null): DetailMatchFile[] {
  const files: DetailMatchFile[] = [];
  const dirs: string[] = [];
  let current: DetailMatchFile | null = null;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const header = FILE_HEADER_RE.exec(line);
    if (header) {
      const depth = headerDepth(line);
      const name = cleanHeaderPath(header[1] ?? "");
      if (name.endsWith("/")) {
        setDirectory(dirs, depth, name);
        current = null;
        continue;
      }
      current = name ? { path: filePathAt(dirs, depth, name), lines: [] } : null;
      if (current) files.push(current);
      continue;
    }
    const row = MATCH_LINE_RE.exec(line);
    if (row) {
      if (!current) {
        current = { path: fallbackPath ?? "", lines: [] };
        files.push(current);
      }
      current.lines.push({
        line: Number(row[2]),
        text: row[3] ?? "",
        match: row[1] === "*",
      });
      continue;
    }
    const meta = /^\s{2,}meta:\s*(.+)$/.exec(line);
    if (meta && current) {
      current.lines.push({ line: null, text: `meta: ${meta[1]}`, match: false });
    }
  }
  return files.filter((file) => file.lines.length > 0);
}

function parseEditDiffs(
  text: string,
  fallbackPath: string | null,
): Array<{ path: string; diff: string }> {
  const files: Array<{ path: string; diff: string }> = [];
  const dirs: string[] = [];
  let current: { path: string; diff: string[]; lastLine: number | null } | null = null;
  const flush = (): void => {
    if (!current || current.diff.length <= 3) return;
    files.push({ path: current.path, diff: current.diff.join("\n") });
  };
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const header = EDIT_HEADER_RE.exec(line);
    if (header) {
      flush();
      const depth = headerDepth(line);
      const name = cleanHeaderPath(header[1] ?? "");
      if (name.endsWith("/")) {
        setDirectory(dirs, depth, name);
        current = null;
        continue;
      }
      const path = filePathAt(dirs, depth, name);
      current = name
        ? {
            path,
            diff: [`--- a/${path}`, `+++ b/${path}`],
            lastLine: null,
          }
        : null;
      continue;
    }
    const change = EDIT_LINE_RE.exec(line);
    if (!change) continue;
    if (!current) {
      const path = fallbackPath ?? "file";
      current = {
        path,
        diff: [`--- a/${path}`, `+++ b/${path}`],
        lastLine: null,
      };
    }
    const lineNumber = Number(change[2]);
    if (current.lastLine == null || Math.abs(lineNumber - current.lastLine) > 1) {
      current.diff.push(`@@ -${lineNumber} +${lineNumber} @@`);
    }
    current.lastLine = lineNumber;
    current.diff.push(`${change[1]}${change[3] ?? ""}`);
  }
  flush();
  return files;
}

export function pathListCard(
  name: string,
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const entries = opts.isError ? null : pathListFromOutput(parts.text, name);
  const notices = splitTrailingNotice(parts.text).notices;
  const target = textValue(data.path) ?? textValue(data.pattern) ?? ".";
  const sections: Array<DetailSection | null> = entries?.length
    ? [{ kind: "paths", label: "paths", items: entries, notices }]
    : [textSection(parts.text)];
  return buildCard(name, args, parts, opts, {
    target,
    summary: firstLine(parts.text),
    chips: entries ? [{ kind: "count", unit: "items", value: entries.length }] : [],
    flags: opts.isError ? ["failed"] : notices.length ? ["truncated"] : [],
    sections,
  });
}

export function astGrepCard(
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const details = parts.details ?? {};
  const matchCount = numberValue(details.matchCount);
  const fileCount = numberValue(details.fileCount);
  const searched = numberValue(details.filesSearched);
  const parseErrors = arrayValue(details.parseErrors).filter(
    (entry): entry is string => typeof entry === "string",
  );
  const scope = textValue(details.scopePath) ?? textValue(data.path);
  const display = textValue(details.displayContent);
  const files = parseMatchGroups(display ?? "", scope);
  const sections: Array<DetailSection | null> = files.length
    ? [{ kind: "matches", label: "matches", files, notices: parseErrors }]
    : [textSection(parts.text)];
  const chips: DetailChip[] = [];
  if (matchCount != null) chips.push({ kind: "count", unit: "matches", value: matchCount });
  if (fileCount != null) chips.push({ kind: "count", unit: "files", value: fileCount });
  if (searched != null) chips.push({ kind: "count", unit: "searched", value: searched });
  if (scope && scope !== ".") chips.push({ kind: "text", text: scope });
  return buildCard("ast_grep", args, parts, opts, {
    target: firstLine(textValue(data.pat)),
    summary: scope && scope !== "." ? scope : null,
    chips,
    flags: [
      ...(details.limitReached === true ? (["limit"] as const) : []),
      ...(matchCount === 0 ? (["noMatches"] as const) : []),
    ],
    sections,
  });
}

export function astEditCard(
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const details = parts.details ?? {};
  const replacements = numberValue(details.totalReplacements);
  const filesTouched = numberValue(details.filesTouched);
  const searched = numberValue(details.filesSearched);
  const display = textValue(details.displayContent);
  const paths = arrayValue(data.paths)
    .map((entry) => textValue(entry))
    .filter((entry): entry is string => entry != null);
  const diffs = parseEditDiffs(display ?? "", paths[0] ?? null);
  const sections: Array<DetailSection | null> = diffs.length
    ? [{ kind: "diffs", label: "code", files: diffs }]
    : [textSection(parts.text)];
  const chips: DetailChip[] = [];
  if (replacements != null) {
    chips.push({ kind: "count", unit: "replacements", value: replacements });
  }
  if (filesTouched != null) chips.push({ kind: "count", unit: "files", value: filesTouched });
  if (searched != null) chips.push({ kind: "count", unit: "searched", value: searched });
  const target = paths.length
    ? `${paths[0]}${paths.length > 1 ? ` +${paths.length - 1}` : ""}`
    : null;
  return buildCard("ast_edit", args, parts, opts, {
    target,
    summary: null,
    chips,
    flags: opts.isError
      ? ["failed"]
      : [
          ...(details.applied === true ? (["applied"] as const) : (["preview"] as const)),
          ...(details.limitReached === true ? (["limit"] as const) : []),
        ],
    sections,
  });
}

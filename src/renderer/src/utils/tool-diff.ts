/** Parse Pi coding-agent tool payloads for Cursor-like tool cards. */

import type { ChatMessage } from "../stores/chat-reducer";
import { safeStringify } from "./safe-json";
import { languageFromPath } from "./editor-lang";
import { parseGrepOutput, type GrepFileHits } from "./grep-card";
import { parseDetailTool, type DetailToolCard } from "./tool-detail";
import { isRecord, toolCommandFromArgs, toolPathFromArgs } from "./tool-args";
import { resolveXdevToolCall } from "./tool-xdev";
import {
 isTodoToolName,
 todoActionFromPayload,
 todoItemsFromToolArgs,
 todosFromToolArgs,
 todosFromToolDetails,
} from "./session-todos";

export type ToolMessage = Extract<ChatMessage, { role: "tool" }>;

/**
 * Canonical per-message-object memo for tool cards. Committed rows are
 * immutable, so each parses at most once no matter how many consumers
 * (message list, work sections, docks, session info) ask for it — write/edit
 * diff synthesis is O(file size) and must not repeat across those.
 */
const toolCardMemo = new WeakMap<ToolMessage, ToolCard>();

/**
 * 解析抛错时退化为纯文本卡片并缓存：卡片解析在 MessageList 的模板/computed 里调用，
 * 一次抛错会让整个消息列表停止更新（Vue 只停更出错的组件），且下次渲染重复抛错。
 */
function fallbackToolCard(msg: ToolMessage): ToolCard {
 const rendered = [msg.args, msg.result]
  .filter((v) => v != null)
  .map((v) => safeStringify(v, 2))
  .filter(Boolean)
  .join("\n");
 return {
  kind: "generic",
  summary: msg.toolName,
  preview: rendered ? rendered.slice(0, 20_000) : null,
  images: [],
  structured: null,
  args: null,
  previewFromArgs: msg.result == null && msg.args != null,
 };
}

export function toolCardFor(msg: ToolMessage): ToolCard {
 let card = toolCardMemo.get(msg);
 if (!card) {
  try {
   card = parseToolCard(msg.toolName, msg.args, msg.result, {
    isError: msg.isError,
    durationMs: typeof msg.durationMs === "number" ? msg.durationMs : undefined,
    startedAt: typeof msg.startedAt === "number" ? msg.startedAt : undefined,
   });
  } catch {
   card = fallbackToolCard(msg);
  }
  toolCardMemo.set(msg, card);
 }
 return card;
}

export type ToolDiffStats = {
 additions: number;
 deletions: number;
};

export type FileToolCard = {
 kind: "edit" | "write" | "other";
 path: string | null;
 stats: ToolDiffStats | null;
 /** 统一的 unified diff：pi 的 display 格式在解析时就归一化掉。 */
 diff: string | null;
 /** Execution duration stamped by the reducer (live turns only). */
 durationMs?: number | null;
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
 /** 语言 id（按扩展名推断），用于语法高亮。 */
 lang: string;
 /** Execution duration stamped by the reducer (live turns only). */
 durationMs?: number | null;
};

export type BashToolCard = {
 kind: "bash";
 command: string | null;
 linesRead: number | null;
 totalLines: number | null;
 truncated: boolean;
 preview: string | null;
 /** structuredContent.exit_code；历史回合缺失时从输出尾部解析。 */
 exitCode: number | null;
 /** structuredContent.wall_time_seconds。 */
 wallTimeSeconds: number | null;
 /** 输出被截断时的完整日志路径。 */
 fullOutputPath: string | null;
 /** Execution duration stamped by the reducer (live turns only). */
 durationMs?: number | null;
};

export type GrepToolCard = {
 kind: "grep";
 pattern: string | null;
 /** 搜索根（args.path）；输出里的相对路径要靠它拼回可打开的路径。 */
 searchPath: string | null;
 glob: string | null;
 ignoreCase: boolean;
 literal: boolean;
 hits: GrepFileHits[];
 matchCount: number;
 noMatches: boolean;
 /** 尾部提示原文：匹配上限 / 字节截断 / 单行截断。 */
 notices: string[];
 /** 剥掉尾部提示后的文本：解析不出命中时按纯文本显示。 */
 preview: string | null;
 /** Execution duration stamped by the reducer (live turns only). */
 durationMs?: number | null;
};

export type TodoToolCard = {
 kind: "todo";
 action: string | null;
 items: Array<{ id: string; text: string; done: boolean }>;
 /** 全量清单的条目数；增量操作没有全量快照时为 null（进度没有意义）。 */
 total: number | null;
 summary: string | null;
};

/** omp 为后台任务生成的实时活动视图（JobWidgetView 的子集）。 */
export type WaitWidgetBlock =
 | {
  kind: "spark";
  label: string;
  values: number[];
  min: number;
  max: number;
  last: string;
  tone: string | null;
 }
 | {
  kind: "bars";
  label: string;
  max: number;
  items: Array<{ label: string; value: number; text: string; tone: string | null }>;
 }
 | { kind: "meter"; label: string; value: number; text: string; tone: string | null }
 | {
  kind: "stat";
  items: Array<{ label: string; text: string; tone: string | null; trend: string | null }>;
 }
 | {
  kind: "grid";
  label: string;
  items: Array<{ label: string; text: string; tone: string | null }>;
 }
 | { kind: "text"; text: string };

export type WaitWidget = {
 title: string;
 headline: { text: string; label: string | null; trend: string | null; tone: string | null } | null;
 /** 任务此刻在做什么：task 的自主阶段，或 bash 的最后一行输出。 */
 stage: string | null;
 blocks: WaitWidgetBlock[];
 state: "authoring" | "live" | "fallback";
};

/** wait 工具等待的一个后台任务（bash / task / eval），字段取自 omp 的 JobSnapshot。 */
export type WaitJob = {
 id: string;
 type: string;
 status: "running" | "completed" | "failed" | "cancelled";
 label: string;
 intent: string | null;
 /** task 类型对应的子代理 id（agentUrlId 优先），用于读取对话。 */
 agentId: string | null;
 durationMs: number;
 exitCode: number | null;
 completionPercent: number | null;
 stage: string | null;
 requests: number | null;
 cost: number | null;
 contextTokens: number | null;
 contextWindow: number | null;
 model: string | null;
 resultText: string | null;
 errorText: string | null;
 widget: WaitWidget | null;
};

export type WaitToolCard = {
 kind: "wait";
 /** 本轮 wait 正在等 / 等待过的后台任务；omp 每 500ms 推一次快照。 */
 jobs: WaitJob[];
 /** 工具结果文本：等待结束时的说明，或空等待的原因。 */
 text: string | null;
 /** 实时回合的调用开始时间，用于累计等待时长。 */
 startedAt: number | null;
 /** 这份任务快照被解析的时刻：两次推送之间按它外推任务耗时。 */
 observedAt: number | null;
 /** 等待被消息或中断提前结束。 */
 interrupted: boolean;
 durationMs?: number | null;
};

export type GenericToolCard = {
 kind: "generic";
 summary: string | null;
 preview: string | null;
 /** 工具结果里的图片块（codemode 生成图等），已转成 data URL。 */
 images: string[];
 /** structuredContent：MCP / pi 工具的结构化结果，可直接渲染成 JSON 树。 */
 structured: unknown | null;
 /** 原始调用参数：渲染层据此说明「这个工具操作了哪个路径」。 */
 args: unknown;
 /** 结果为空时 preview 退回了参数 JSON，不能当工具输出做结构化解析。 */
 previewFromArgs: boolean;
 /** Execution duration stamped by the reducer (live turns only). */
 durationMs?: number | null;
};

export type ToolCard =
 | FileToolCard
 | ReadToolCard
 | BashToolCard
 | GrepToolCard
 | TodoToolCard
 | WaitToolCard
 | DetailToolCard
 | GenericToolCard;

/** 工具结果里最多渲染的图片块数（生成图可能很大，避免撑爆内存）。 */
const MAX_TOOL_RESULT_IMAGES = 8;

/** `{ type: "image", data, mimeType }` 块 → data URL；非法或超出上限的丢弃。 */
function imageDataUrls(content: unknown): string[] {
 if (!Array.isArray(content)) return [];
 const out: string[] = [];
 for (const block of content) {
  if (out.length >= MAX_TOOL_RESULT_IMAGES) break;
  if (!isRecord(block) || block.type !== "image") continue;
  const data = block.data;
  const mimeType = block.mimeType;
  if (typeof data !== "string" || !data) continue;
  if (typeof mimeType !== "string" || !mimeType.startsWith("image/")) continue;
  out.push(`data:${mimeType};base64,${data}`);
 }
 return out;
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
 images: string[];
 /** structuredContent：pi / MCP 工具的结构化结果。 */
 structured: unknown | null;
} {
 if (!isRecord(result)) {
  return { details: null, text: result == null ? "" : String(result), images: [], structured: null };
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
 const images = imageDataUrls(result.content);
 const structured = result.structuredContent ?? null;
 if (!details && (typeof result.diff === "string" || typeof result.patch === "string")) {
  return { details: result, text, images, structured };
 }
 return { details, text, images, structured };
}

function stringArg(args: unknown, key: string): string | null {
 if (!isRecord(args)) return null;
 const value = args[key];
 return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** 通用工具的参数里最能说明「干了什么」的字段，按优先级排列。 */
const GENERIC_TARGET_KEYS = [
 "path",
 "file_path",
 "filePath",
 "command",
 "cmd",
 "pattern",
 "query",
 "url",
 "prompt",
 "description",
];

/** 摘要截断：压掉换行、在词边界断开，避免出现半截 token。 */
function truncateSummary(text: string, max = 64): string {
 const flat = text.replace(/\s+/g, " ").trim();
 if (flat.length <= max) return flat;
 const cut = flat.slice(0, max);
 const space = cut.lastIndexOf(" ");
 const head = space > max * 0.6 ? cut.slice(0, space) : cut;
 return `${head.trimEnd()}…`;
}

/**
 * 通用工具摘要：优先取能说明「干了什么」的参数；
 * 都没有时退回脚本首行或参数 JSON，而不是甩一坨原始参数。
 */
function genericSummary(args: unknown): string | null {
 if (!isRecord(args)) return null;
 for (const key of GENERIC_TARGET_KEYS) {
  const value = args[key];
  if (typeof value === "string" && value.trim()) return truncateSummary(value.trim());
 }
 const code = args.code;
 if (typeof code === "string" && code.trim()) {
  const first = code.split("\n").find((line) => line.trim()) ?? "";
  if (first.trim()) return truncateSummary(first.trim());
 }
 return truncateSummary(safeStringify(args));
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

/**
 * Marker emitted by chat-reducer's display caps on oversized tool output —
 * the count is the ORIGINAL output's total lines, so cards can still show the
 * real figure after the middle of the text was trimmed for storage.
 */
const OUTPUT_CAP_MARKER_RE = /\u2026 \[output truncated, (\d+) lines total\]/;

function parseOutputCapMarker(text: string): number | null {
 const m = text.match(OUTPUT_CAP_MARKER_RE);
 return m ? Number(m[1]) : null;
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

function previewWriteContent(content: string, path: string | null): string {
 const lines = content.replace(/\r\n/g, "\n").split("\n");
 // Trailing empty line from final newline is normal for files — keep it in the count
 // but present as a pure addition diff (new file / full rewrite).
 // Full content: the tool card body scrolls and sticks to the latest lines.
 const total = lines.length;
 const fileLabel = path ? path.replace(/\\/g, "/") : "file";
 const header = [
  `--- /dev/null`,
  `+++ b/${fileLabel}`,
  `@@ -0,0 +1,${total} @@`,
 ];
 const body = lines.map((l) => `+${l}`).join("\n");
 return `${header.join("\n")}\n${body}`;
}

function contentFromWriteArgs(args: unknown): string {
 if (!isRecord(args)) return "";
 const candidates = [args.content, args.contents, args.text, args.new_content, args.newContent];
 for (const c of candidates) {
  if (typeof c === "string") return c;
 }
 return "";
}

/**
 * pi 的 display diff（`+198 text` / ` 197 text`）归一化成 unified。
 *
 * 渲染层只认 unified 一种格式：display diff 会让整张卡片退化成纯文本预览。
 */
function normalizeDiff(raw: string, path: string | null): string {
 if (raw.includes("@@")) return raw;
 const label = (path ?? "file").replace(/\\/g, "/");
 const body = raw
  .replace(/\r\n/g, "\n")
  .split("\n")
  .map((line) => {
   const match = /^([+\- ])\s*\d*\s(.*)$/.exec(line);
   return match ? `${match[1]}${match[2]}` : line;
  });
 return [`--- a/${label}`, `+++ b/${label}`, "@@", ...body].join("\n");
}

function previewEditFromArgs(args: unknown, path: string | null): string | null {
 if (!isRecord(args)) return null;
 // Single edit shape
 const oldOne =
  typeof args.oldText === "string"
   ? args.oldText
   : typeof args.old_string === "string"
    ? args.old_string
    : typeof args.old_str === "string"
     ? args.old_str
     : null;
 const newOne =
  typeof args.newText === "string"
   ? args.newText
   : typeof args.new_string === "string"
    ? args.new_string
    : typeof args.new_str === "string"
     ? args.new_str
     : null;
 if (oldOne != null && newOne != null) {
  const fileLabel = path ? path.replace(/\\/g, "/") : "file";
  const oldLines = oldOne.replace(/\r\n/g, "\n").split("\n");
  const newLines = newOne.replace(/\r\n/g, "\n").split("\n");
  return [
   `--- a/${fileLabel}`,
   `+++ b/${fileLabel}`,
   `@@`,
   ...oldLines.map((l) => `-${l}`),
   ...newLines.map((l) => `+${l}`),
  ].join("\n");
 }
 // Multi-edit array
 if (Array.isArray(args.edits)) {
  const parts: string[] = [];
  for (const edit of args.edits) {
   if (!isRecord(edit)) continue;
   const o =
    typeof edit.oldText === "string"
     ? edit.oldText
     : typeof edit.old_string === "string"
      ? edit.old_string
      : null;
   const n =
    typeof edit.newText === "string"
     ? edit.newText
     : typeof edit.new_string === "string"
      ? edit.new_string
      : null;
   if (o == null || n == null) continue;
   parts.push(
    ...o.replace(/\r\n/g, "\n").split("\n").map((l) => `-${l}`),
    ...n.replace(/\r\n/g, "\n").split("\n").map((l) => `+${l}`),
   );
  }
  if (!parts.length) return null;
  const fileLabel = path ? path.replace(/\\/g, "/") : "file";
  return [`--- a/${fileLabel}`, `+++ b/${fileLabel}`, `@@`, ...parts].join("\n");
 }
 return null;
}

export function parseFileToolCard(
 toolName: string,
 args: unknown,
 result: unknown,
 opts?: { isError?: boolean; durationMs?: number },
): FileToolCard {
 const name = toolName.toLowerCase();
 const path = toolPathFromArgs(args);
 const { details, text } = extractToolResult(result);

 // Blocked tools (e.g. desktop security deny) should surface the reason, not a fake diff.
 if (opts?.isError && text.trim()) {
  const kind =
   name === "write" || name === "write_file" || name === "create_file"
    ? ("write" as const)
    : name === "edit" || name === "str_replace" || name === "search_replace"
     ? ("edit" as const)
     : ("other" as const);
  return {
   kind,
   path,
   stats: null,
   diff: text.trim() ? text : null,
  };
 }

 if (name === "edit" || name === "str_replace" || name === "search_replace") {
  // pi 同时给 display diff 与 unified patch：统一成 unified，渲染层只认一种格式。
  const raw =
   (typeof details?.patch === "string" ? details.patch : null) ||
   (typeof details?.diff === "string" ? details.diff : null) ||
   previewEditFromArgs(args, path);
  const diff = raw ? normalizeDiff(raw, path) : null;
  return {
   kind: "edit",
   path,
   stats: diff ? countDiffStats(diff) : null,
   diff,
   durationMs: opts?.durationMs ?? null,
  };
 }

 if (name === "write" || name === "write_file" || name === "create_file") {
  const detailsDiff = typeof details?.diff === "string" ? details.diff : null;
  const detailsPatch = typeof details?.patch === "string" ? details.patch : null;
  const raw = detailsPatch || detailsDiff;
  if (raw) {
   const diff = normalizeDiff(raw, path);
   return {
    kind: "write",
    path,
    stats: countDiffStats(diff),
    diff,
    durationMs: opts?.durationMs ?? null,
   };
  }
  const content = contentFromWriteArgs(args);
  const lineCount = content ? content.replace(/\r\n/g, "\n").split("\n").length : 0;
  return {
   kind: "write",
   path,
   stats: content ? { additions: lineCount, deletions: 0 } : null,
   // New / full rewrite: present every line as an addition.
   diff: content ? previewWriteContent(content, path) : null,
   durationMs: opts?.durationMs ?? null,
  };
 }

 return {
  kind: "other",
  path,
  stats: null,
  diff: text.trim() ? text : null,
  durationMs: opts?.durationMs ?? null,
 };
}

export function parseReadToolCard(
 args: unknown,
 result: unknown,
 opts?: { durationMs?: number },
): ReadToolCard {
 const path = toolPathFromArgs(args);
 const { details, text } = extractToolResult(result);
 const trunc = truncationFromDetails(details);
 const notice = parseLineRangeNotice(text);
 const capLines = parseOutputCapMarker(text);
 const offset =
  isRecord(args) && typeof args.offset === "number" ? Math.max(1, args.offset) : null;
 const limit =
  isRecord(args) && typeof args.limit === "number" ? Math.max(0, args.limit) : null;

 let linesRead = trunc.linesRead ?? notice.linesRead;
 if (linesRead == null && capLines != null) linesRead = capLines;
 if (linesRead == null && text) {
  // Strip trailing truncation notices before counting
  const body = text.replace(/\n\n\[Showing lines[\s\S]*$/i, "").replace(/\n\n\[\d+ more lines[\s\S]*$/i, "");
  linesRead = countTextLines(body);
 }
 if (linesRead == null && limit != null) linesRead = limit;
 let totalLines = trunc.totalLines ?? notice.totalLines;
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
  preview: text.trim() ? text : null,
  lang: path ? languageFromPath(path) : "plaintext",
  durationMs: opts?.durationMs ?? null,
 };
}

/** read 工具结果尾部会跟一句「显示第几行 / 共几行」的提示，文件视图里要剥掉。 */
export function readPreviewText(text: string): string {
 return text
  .replace(/\n\n\[Showing lines[\s\S]*$/i, "")
  .replace(/\n\n\[\d+ more lines[\s\S]*$/i, "")
  .replace(/\n\n\[output truncated[^\n]*\]$/i, "")
  .replace(/\s+$/, "");
}

/** structuredContent 里的数值字段。 */
function structuredNumber(structured: unknown, key: string): number | null {
 if (!isRecord(structured)) return null;
 const value = structured[key];
 return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 失败时 pi 会在输出尾部追加 "Command exited with code N"，旧回合没有 structuredContent 时兜底用。 */
const EXIT_CODE_RE = /Command exited with code (\d+)/;

/** 终端输出里的 ANSI 转义（PowerShell 默认带颜色），终端卡是纯文本渲染，解析时先剥掉。 */
const ANSI_ESCAPE_RE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;

function parseExitCode(text: string): number | null {
 const match = EXIT_CODE_RE.exec(text);
 return match ? Number(match[1]) : null;
}

export function parseBashToolCard(
 args: unknown,
 result: unknown,
 opts?: { durationMs?: number },
): BashToolCard {
 const { details, text: rawText, structured } = extractToolResult(result);
 const text = rawText.replace(ANSI_ESCAPE_RE, "");
 const trunc = truncationFromDetails(details);
 const notice = parseLineRangeNotice(text);
 const capLines = parseOutputCapMarker(text);
 let linesRead = trunc.linesRead ?? notice.linesRead;
 if (linesRead == null && capLines != null) linesRead = capLines;
 if (linesRead == null && text) linesRead = countTextLines(text);
 const exitCode = structuredNumber(structured, "exit_code") ?? parseExitCode(text);
 return {
  kind: "bash",
  command: toolCommandFromArgs(args),
  linesRead,
  totalLines: trunc.totalLines ?? notice.totalLines,
  truncated: trunc.truncated,
  preview: text.trim() ? text : null,
  exitCode,
  wallTimeSeconds: structuredNumber(structured, "wall_time_seconds"),
  fullOutputPath:
   details && typeof details.fullOutputPath === "string" ? details.fullOutputPath : null,
  durationMs: opts?.durationMs ?? null,
 };
}

export function parseGrepToolCard(
 args: unknown,
 result: unknown,
 opts?: { durationMs?: number },
): GrepToolCard {
 const { text } = extractToolResult(result);
 const searchPath = toolPathFromArgs(args);
 const parsed = parseGrepOutput(text, searchPath);
 return {
  kind: "grep",
  pattern: stringArg(args, "pattern"),
  searchPath,
  glob: stringArg(args, "glob"),
  ignoreCase: isRecord(args) && args.ignoreCase === true,
  literal: isRecord(args) && args.literal === true,
  hits: parsed.hits,
  matchCount: parsed.matchCount,
  noMatches: parsed.noMatches,
  notices: parsed.notices,
  preview: parsed.text.trim() ? parsed.text : null,
  durationMs: opts?.durationMs ?? null,
 };
}

/** 卡片动作：Cursor 用 action，omp 用 op；两边都拿不到时返回 null。 */
function todoActionFor(args: unknown, details: unknown): string | null {
 if (isRecord(args) && typeof args.action === "string") return args.action;
 const fromDetails = details ? todoActionFromPayload(details) : undefined;
 if (typeof fromDetails === "string") return fromDetails;
 if (isRecord(args) && typeof args.op === "string") return args.op;
 return null;
}

export function parseTodoToolCard(args: unknown, result: unknown): TodoToolCard {
 const { details, text } = extractToolResult(result);
 const fromDetails = details ? todosFromToolDetails("todo", details) : null;
 const fromResult =
  !fromDetails && result ? todosFromToolDetails("todo", result) : null;
 const fromArgs = todosFromToolArgs("todo", args);
 const list = fromDetails ?? fromResult ?? fromArgs;
 const items = list?.items ?? todoItemsFromToolArgs(args);
 const action = todoActionFor(args, details);
 const total = list ? list.items.length : null;
 const done = items.filter((item) => item.done).length;
 const summary =
  total != null
   ? `${done}/${total}`
   : text.trim().slice(0, 80) || (action ? action : null);

 return {
  kind: "todo",
  action,
  items,
  total,
  summary,
 };
}

function numberOrNull(value: unknown): number | null {
 return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function trimmedOrNull(value: unknown): string | null {
 return typeof value === "string" && value.trim() ? value.trim() : null;
}

function widgetText(value: unknown, max: number): string | null {
 const text = trimmedOrNull(value);
 if (!text) return null;
 return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function widgetTone(value: unknown): string | null {
 return typeof value === "string" && value ? value : null;
}

type WaitWidgetStatItem = {
 label: string;
 text: string;
 tone: string | null;
 trend: string | null;
};

function parseWidgetStatItems(raw: unknown, limit: number): WaitWidgetStatItem[] {
 if (!Array.isArray(raw)) return [];
 const items: WaitWidgetStatItem[] = [];
 for (const entry of raw) {
  if (items.length >= limit) break;
  if (!isRecord(entry)) continue;
  const label = widgetText(entry.label, 40);
  const text = widgetText(entry.text, 80);
  if (!label || !text) continue;
  items.push({
   label,
   text,
   tone: widgetTone(entry.tone),
   trend: isRecord(entry.trend) ? widgetText(entry.trend.text, 40) : null,
  });
 }
 return items;
}

function parseWidgetBars(
 raw: Record<string, unknown>,
): Extract<WaitWidgetBlock, { kind: "bars" }> | null {
 if (!Array.isArray(raw.items)) return null;
 const items: Array<{ label: string; value: number; text: string; tone: string | null }> = [];
 for (const entry of raw.items) {
  if (items.length >= 12) break;
  if (!isRecord(entry)) continue;
  const label = widgetText(entry.label, 40);
  const value = numberOrNull(entry.value);
  if (!label || value == null) continue;
  items.push({
   label,
   value,
   text: widgetText(entry.text, 60) ?? String(value),
   tone: widgetTone(entry.tone),
  });
 }
 if (!items.length) return null;
 const max = numberOrNull(raw.max) ?? Math.max(...items.map((item) => item.value), 1);
 return {
  kind: "bars",
  label: widgetText(raw.label, 80) ?? "",
  max: max > 0 ? max : 1,
  items,
 };
}

function parseWidgetSpark(
 raw: Record<string, unknown>,
): Extract<WaitWidgetBlock, { kind: "spark" }> | null {
 const values = Array.isArray(raw.values)
  ? raw.values
   .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
   .slice(-64)
  : [];
 const min = numberOrNull(raw.min);
 const max = numberOrNull(raw.max);
 const last = widgetText(raw.last, 80);
 if (!values.length || min == null || max == null || !last) return null;
 return {
  kind: "spark",
  label: widgetText(raw.label, 80) ?? "",
  values,
  min,
  max: max > min ? max : min + 1,
  last,
  tone: widgetTone(raw.tone),
 };
}

function parseWidgetGrid(
 raw: Record<string, unknown>,
): Extract<WaitWidgetBlock, { kind: "grid" }> | null {
 if (!Array.isArray(raw.items)) return null;
 const items: Array<{ label: string; text: string; tone: string | null }> = [];
 for (const entry of raw.items) {
  if (items.length >= 24) break;
  if (!isRecord(entry)) continue;
  const label = widgetText(entry.label, 40);
  const text = widgetText(entry.text, 60);
  if (!label || !text) continue;
  items.push({ label, text, tone: widgetTone(entry.tone) });
 }
 if (!items.length) return null;
 return { kind: "grid", label: widgetText(raw.label, 80) ?? "", items };
}

function parseWidgetMeter(
 raw: Record<string, unknown>,
): Extract<WaitWidgetBlock, { kind: "meter" }> | null {
 const value = numberOrNull(raw.value);
 const text = widgetText(raw.text, 80);
 if (value == null || !text) return null;
 return {
  kind: "meter",
  label: widgetText(raw.label, 80) ?? "",
  value: Math.max(0, Math.min(1, value)),
  text,
  tone: widgetTone(raw.tone),
 };
}

function parseWidgetBlock(raw: unknown): WaitWidgetBlock | null {
 if (!isRecord(raw)) return null;
 switch (raw.kind) {
  case "spark":
   return parseWidgetSpark(raw);
  case "bars":
   return parseWidgetBars(raw);
  case "meter":
   return parseWidgetMeter(raw);
  case "stat": {
   const items = parseWidgetStatItems(raw.items, 8);
   return items.length ? { kind: "stat", items } : null;
  }
  case "grid":
   return parseWidgetGrid(raw);
  case "text": {
   const text = widgetText(raw.text, 500);
   return text ? { kind: "text", text } : null;
  }
  default:
   return null;
 }
}

/** omp 的 JobWidgetView：有 spec 时给指标块，没有时给最后一行与行速率。 */
function parseWaitWidget(raw: unknown): WaitWidget | null {
 if (!isRecord(raw)) return null;
 const blocks: WaitWidgetBlock[] = [];
 if (Array.isArray(raw.blocks)) {
  for (const block of raw.blocks) {
   if (blocks.length >= 8) break;
   const parsed = parseWidgetBlock(block);
   if (parsed) blocks.push(parsed);
  }
 }
 const headlineRaw = isRecord(raw.headline) ? raw.headline : null;
 const headlineText = headlineRaw ? widgetText(headlineRaw.text, 100) : null;
 const trendRaw = headlineRaw && isRecord(headlineRaw.trend) ? headlineRaw.trend : null;
 const headline = headlineText
  ? {
   text: headlineText,
   label: headlineRaw ? widgetText(headlineRaw.label, 40) : null,
   trend: trendRaw ? widgetText(trendRaw.text, 40) : null,
   tone: trendRaw ? widgetTone(trendRaw.tone) : null,
  }
  : null;
 const title = widgetText(raw.title, 120) ?? "";
 const stage = widgetText(raw.stage, 300);
 if (!title && !stage && !headline && !blocks.length) return null;
 return {
  title,
  headline,
  stage,
  blocks,
  state: raw.state === "live" || raw.state === "authoring" ? raw.state : "fallback",
 };
}

function waitJobStatus(value: unknown): WaitJob["status"] {
 if (value === "running" || value === "failed" || value === "cancelled") {
  return value;
 }
 return "completed";
}

function parseWaitJob(raw: unknown): WaitJob | null {
 if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id) return null;
 return {
  id: raw.id,
  type: typeof raw.type === "string" && raw.type ? raw.type : "job",
  status: waitJobStatus(raw.status),
  label: trimmedOrNull(raw.label) ?? raw.id,
  intent: trimmedOrNull(raw.intent),
  agentId:
   trimmedOrNull(raw.agentUrlId) ??
   (raw.type === "task" ? raw.id : null),
  durationMs: numberOrNull(raw.durationMs) ?? 0,
  exitCode: numberOrNull(raw.exitCode),
  completionPercent: numberOrNull(raw.completionPercent),
  stage: trimmedOrNull(raw.stage),
  requests: numberOrNull(raw.requests),
  cost: numberOrNull(raw.cost),
  contextTokens: numberOrNull(raw.contextTokens),
  contextWindow: numberOrNull(raw.contextWindow),
  model: trimmedOrNull(raw.resolvedModel),
  resultText: trimmedOrNull(raw.resultText),
  errorText: trimmedOrNull(raw.errorText),
  widget: parseWaitWidget(raw.widget),
 };
}

/**
 * wait 没有参数，进度全部在 partialResult.details.jobs 里。
 * 不要把空参数 `{}` 当结果：那正是卡片一直显示空壳的原因。
 */
export function parseWaitToolCard(
 result: unknown,
 opts?: { startedAt?: number; durationMs?: number },
): WaitToolCard {
 const { details, text } = extractToolResult(result);
 const rawJobs = details && Array.isArray(details.jobs) ? details.jobs : [];
 const jobs = rawJobs
  .map(parseWaitJob)
  .filter((job): job is WaitJob => job !== null);
 return {
  kind: "wait",
  jobs,
  text: text.trim() ? text : null,
  startedAt: opts?.startedAt ?? null,
  observedAt: Date.now(),
  interrupted: details?.interrupted === true,
  durationMs: opts?.durationMs ?? null,
 };
}

export function parseToolCard(
 toolName: string,
 args: unknown,
 result: unknown,
 opts?: { isError?: boolean; durationMs?: number; startedAt?: number },
): ToolCard {
 const xdev = resolveXdevToolCall(toolName, args, result);
 if (xdev) {
  return parseToolCard(xdev.toolName, xdev.args, xdev.result, opts);
 }
 const name = toolName.toLowerCase();
 if (name === "wait") {
  return parseWaitToolCard(result, opts);
 }
 if (isFileMutationTool(name)) {
  return parseFileToolCard(toolName, args, result, opts);
 }
 if (name === "read" || name === "read_file") {
  return parseReadToolCard(args, result, opts);
 }
 if (isBashTool(name)) {
  return parseBashToolCard(args, result, opts);
 }
 if (isGrepTool(name)) {
  return parseGrepToolCard(args, result, opts);
 }
 if (isTodoToolName(toolName)) {
  return parseTodoToolCard(args, result);
 }
 const extracted = extractToolResult(result);
 const detail = parseDetailTool(toolName, args, extracted, {
  isError: opts?.isError,
  durationMs: opts?.durationMs,
 });
 if (detail) return detail;
 const { text, images, structured } = extracted;
 const summary =
  toolCommandFromArgs(args) ??
  toolPathFromArgs(args) ??
  genericSummary(args);
 return {
  kind: "generic",
  summary,
  preview: text.trim() ? text : (args != null ? safeStringify(args, 2) : null),
  images,
  structured,
  args: args ?? null,
  previewFromArgs: !text.trim() && args != null,
  durationMs: opts?.durationMs ?? null,
 };
}

/** 工具耗时：只有带执行计时的卡片才有值。 */
export function toolCardDurationMs(card: ToolCard): number | null {
 if (card.kind === "todo") return null;
 return card.durationMs ?? null;
}

/**
 * 嵌套调用（codemode 脚本里发出的工具调用）没有独立的 ToolMessage，
 * 按同样的规则解析出一张卡片，渲染层才能给它同样的分型视图。
 *
 * 流式期间 reducer 每次更新都重建 call 对象，因此缓存按 toolCallId 命中，
 * 再用参数/结果的引用判断内容是否真的变了。
 */
type NestedCardEntry = {
 args: unknown;
 result: unknown;
 isError: boolean | undefined;
 durationMs: number | undefined;
 card: ToolCard;
};

const nestedCardCache = new Map<string, NestedCardEntry>();
const NESTED_CARD_CACHE_MAX = 512;

export function toolCardForNested(call: {
 toolCallId: string;
 toolName: string;
 args?: unknown;
 result?: unknown;
 isError?: boolean;
 durationMs?: number;
}): ToolCard {
 const cached = nestedCardCache.get(call.toolCallId);
 if (
  cached &&
  cached.args === call.args &&
  cached.result === call.result &&
  cached.isError === call.isError &&
  cached.durationMs === call.durationMs
 ) {
  return cached.card;
 }
 const card = parseToolCard(call.toolName, call.args ?? {}, call.result ?? null, {
  isError: call.isError,
  durationMs: call.durationMs,
 });
 if (nestedCardCache.size >= NESTED_CARD_CACHE_MAX) nestedCardCache.clear();
 nestedCardCache.set(call.toolCallId, {
  args: call.args,
  result: call.result,
  isError: call.isError,
  durationMs: call.durationMs,
  card,
 });
 return card;
}

/** 卡片是否有可展开的内容：没有内容的行不显示展开箭头。 */
export function toolCardExpandable(card: ToolCard): boolean {
 switch (card.kind) {
  case "read":
   return Boolean(card.preview);
  case "bash":
   return Boolean(card.preview || card.command);
  case "grep":
   return Boolean(card.preview || card.hits.length);
  case "edit":
  case "write":
  case "other":
   return Boolean(card.diff);
  case "generic":
   return Boolean(card.preview || card.structured);
  case "todo":
   return card.items.length > 0;
  case "wait":
   return card.jobs.length > 0 || Boolean(card.text) || card.startedAt != null;
  case "detail":
   return card.sections.length > 0 || card.transcripts.length > 0;
  default: {
   const _never: never = card;
   return Boolean(_never);
  }
 }
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

export function isGrepTool(toolName: string): boolean {
 return toolName.toLowerCase() === "grep";
}

export function isReadTool(toolName: string): boolean {
 const n = toolName.toLowerCase();
 return n === "read" || n === "read_file";
}

export function isBashTool(toolName: string): boolean {
 const n = toolName.toLowerCase();
 return (
  n === "bash" ||
  n === "powershell" ||
  n === "pwsh" ||
  n === "shell" ||
  n === "execute" ||
  n === "run" ||
  n === "run_terminal_cmd" ||
  n === "terminal" ||
  n === "exec"
 );
}

/**
 * 通用工具结果的结构化解析。
 *
 * pi 的 ls / find 返回逐行路径清单，codemode 返回带小节标题的脚本报告，
 * 直接当纯文本糊出来会把结构丢掉 —— 这里把它们还原成可分型渲染的块。
 */

import { parseJsonPayload } from "./json-tree";
import { toolCommandFromArgs, toolPathFromArgs } from "./tool-diff";

/** "===== src/foo.ts =====" 形式的小节标题。 */
const FILE_SECTION_RE = /^={3,}\s*(.+?)\s*={3,}\s*$/;

/** codemode 的文本小节标题：==> text 1/6 <== */
const TEXT_SECTION_RE = /^==>\s*text\s+(\d+)\/(\d+)\s*<==$/;

export type StructuredBlock =
  | { kind: "text"; text: string }
  | { kind: "code"; path: string; code: string }
  | { kind: "console"; lines: string[] };

export type ScriptSection = {
  title: string | null;
  blocks: StructuredBlock[];
};

export type ScriptReport = {
  status: "completed" | "failed";
  wallTime: string | null;
  error: string | null;
  sections: ScriptSection[];
};

/** 返回逐行路径清单的工具（pi 内置 ls/find 与常见的 MCP 目录列举）。 */
const PATH_LIST_TOOLS = new Set([
  "ls",
  "dir",
  "tree",
  "find",
  "glob",
  "listdir",
  "list_dir",
  "list_directory",
  "list_files",
  "read_dir",
  "readdir",
]);

/** 工具名是否属于路径清单类（MCP 工具名形如 mcp__fs__list_directory）。 */
export function isPathListTool(toolName: string): boolean {
  const tail = toolName.toLowerCase().split("__").pop() ?? toolName.toLowerCase();
  return PATH_LIST_TOOLS.has(tail);
}

/** 逐行拆分路径清单，顺带去掉 ls 的截断提示与空目录占位。 */
export function pathListEntries(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !(line.startsWith("[") && line.endsWith("]")))
    .filter((line) => line !== "(empty directory)");
}

/**
 * 路径清单识别：每行一个路径，且不长得像一句话。
 *
 * 只在「工具名已知」或「形态高度确定」时采用：
 * 随便一段 hello / world 的输出不能被当成文件清单。
 */
export function parsePathList(text: string): string[] | null {
  const entries = pathListEntries(text);
  if (entries.length < 2) return null;
  const pathLike = /^[^\s]+$/;
  if (!entries.every((entry) => pathLike.test(entry))) return null;
  const hasStructure = entries.every(
    (entry) => entry.endsWith("/") || entry.includes("/") || /\.[A-Za-z0-9]+$/.test(entry),
  );
  if (!hasStructure) return null;
  return entries;
}

/** 文本块按空行聚成多段，避免一整坨。 */
function textBlocks(lines: string[]): StructuredBlock[] {
  const blocks: StructuredBlock[] = [];
  let buffer: string[] = [];
  const flush = (): void => {
    const text = buffer.join("\n").trim();
    if (text) blocks.push({ kind: "text", text });
    buffer = [];
  };
  for (const line of lines) {
    if (!line.trim()) {
      flush();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return blocks;
}

/** 把一段原始行切成文件小节 / console 块 / 普通文本块。 */
function splitBlocks(lines: string[]): StructuredBlock[] {
  const blocks: StructuredBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fileMatch = FILE_SECTION_RE.exec(line.trim());
    if (fileMatch) {
      const path = fileMatch[1]!;
      i += 1;
      const body: string[] = [];
      while (i < lines.length && !FILE_SECTION_RE.test(lines[i]!.trim())) {
        body.push(lines[i]!);
        i += 1;
      }
      blocks.push({ kind: "code", path, code: body.join("\n") });
      continue;
    }
    if (line.trim() === "<console_output>") {
      i += 1;
      const body: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== "</console_output>") {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1;
      blocks.push({ kind: "console", lines: body });
      continue;
    }
    const plain: string[] = [];
    while (
      i < lines.length &&
      !FILE_SECTION_RE.test(lines[i]!.trim()) &&
      lines[i]!.trim() !== "<console_output>"
    ) {
      plain.push(lines[i]!);
      i += 1;
    }
    blocks.push(...textBlocks(plain));
  }
  return blocks;
}

/** 目录列举工具（ls / list_directory 一类）。find / glob 搜的是文件，不算。 */
const DIRECTORY_LIST_TOOLS = new Set([
  "ls",
  "dir",
  "tree",
  "listdir",
  "list_dir",
  "list_directory",
  "read_dir",
  "readdir",
]);

/** 工具名是否用于列举一个目录的内容。 */
export function isDirectoryListTool(toolName: string): boolean {
  const tail = toolName.toLowerCase().split("__").pop() ?? toolName.toLowerCase();
  return DIRECTORY_LIST_TOOLS.has(tail);
}

/** 目录参数：path / dir / directory / folder。 */
function directoryPathFromArgs(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  for (const key of ["path", "dir", "directory", "folder"]) {
    const value = (args as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function baseName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * 目录列举工具的目标：工作区根目录显示文件夹名（"." 对人没意义），
 * 其余路径去掉末尾斜杠后显示。
 *
 * 目录工具的 path 参数是可选的（pi 的 ls 默认取 "."），缺省时按 "." 处理。
 */
export function directoryListTarget(
  args: unknown,
  workspaceRoot: string | null,
): string | null {
  const path = directoryPathFromArgs(args) ?? ".";
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return "/";
  if (normalized !== ".") return normalized;
  const name = workspaceRoot ? baseName(workspaceRoot) : null;
  return name || path;
}

/**
 * generic 工具的操作目标：它读/写/查的是哪个路径、哪条命令、哪个查询。
 *
 * 行里显示的必须是「操作了什么」，不能拿结果内容顶替 ——
 * 结果内容另有一处摘要位（genericStepPreview）。
 */
export function genericStepTarget(args: unknown): string | null {
  const path = toolPathFromArgs(args);
  if (path) return path;
  const command = toolCommandFromArgs(args);
  if (command) return command.length > 64 ? `${command.slice(0, 63)}…` : command;
  if (args && typeof args === "object") {
    for (const key of ["pattern", "query", "url", "prompt", "description"]) {
      const value = (args as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) {
        const text = value.trim();
        return text.length > 64 ? `${text.slice(0, 63)}…` : text;
      }
    }
    // codemode 传的是脚本源码：取第一行有内容的代码当作「干了什么」。
    const code = (args as Record<string, unknown>).code;
    if (typeof code === "string" && code.trim()) {
      const first = code.split("\n").find((line) => line.trim()) ?? "";
      const text = first.trim();
      if (text) return text.length > 64 ? `${text.slice(0, 63)}…` : text;
    }
  }
  return null;
}

/**
 * generic 工具结果的量级摘要：只说「产出了多少 / 什么结构」，
 * 不展开内容 —— 内容留给展开后的分型视图。
 *
 * 只返回结构化数据，文案由渲染层按当前语言格式化（这里写死中文会漏到英文界面）。
 */
export type GenericPreview =
  | { kind: "count"; count: number }
  | { kind: "sections"; count: number; wallTime: string | null }
  | { kind: "keys"; keys: string[] };

/**
 * 路径清单的最终判定：已知清单工具仍要求每行是单个路径，
 * 失败输出和参数兜底文本不能混成清单。
 */
export function pathListFromOutput(text: string, toolName: string): string[] | null {
  if (isPathListTool(toolName)) {
    const entries = pathListEntries(text);
    if (!entries.length) return null;
    return entries.every((entry) => !/\s/.test(entry)) ? entries : null;
  }
  return parsePathList(text);
}

export function genericStepPreview(
  card: { preview: string | null; structured: unknown | null; previewFromArgs?: boolean },
  toolName: string,
  opts?: { isError?: boolean },
): GenericPreview | null {
  const text = card.preview ?? "";
  const entries =
    opts?.isError || card.previewFromArgs
      ? null
      : pathListFromOutput(text, toolName);
  if (entries?.length) return { kind: "count", count: entries.length };
  const report = parseScriptReport(text);
  if (report) {
    return { kind: "sections", count: report.sections.length, wallTime: report.wallTime };
  }
  const parsed =
    card.structured ?? (card.previewFromArgs ? null : parseJsonPayload(text));
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const keys = Object.keys(parsed);
    if (keys.length) return { kind: "keys", keys };
  }
  return null;
}

/**
 * 解析 codemode 的脚本报告。
 *
 * 格式（见 pi-coding-agent/docs/codemode.md）：
 * Script completed | Script failed
 * Wall time 0.5 seconds
 * Output:
 * ==> text 1/6 <==
 * ...
 * <console_output>
 * ...
 */
export function parseScriptReport(text: string): ScriptReport | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const first = (lines[0] ?? "").trim();
  if (first !== "Script completed" && first !== "Script failed") return null;
  const status: ScriptReport["status"] = first === "Script completed" ? "completed" : "failed";

  let cursor = 1;
  let wallTime: string | null = null;
  const wall = (lines[cursor] ?? "").trim();
  if (/^Wall time\b/i.test(wall)) {
    wallTime = wall;
    cursor += 1;
  }
  if (/^Output:$/i.test((lines[cursor] ?? "").trim())) cursor += 1;

  const rawSections: Array<{ title: string | null; lines: string[] }> = [];
  let current: { title: string | null; lines: string[] } = { title: null, lines: [] };
  for (let i = cursor; i < lines.length; i++) {
    const line = lines[i]!;
    const match = TEXT_SECTION_RE.exec(line.trim());
    if (match) {
      rawSections.push(current);
      current = { title: `text ${match[1]}/${match[2]}`, lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  rawSections.push(current);

  let error: string | null = null;
  const sections: ScriptSection[] = [];
  for (const section of rawSections) {
    const sectionLines = [...section.lines];
    const errorIndex = sectionLines.findIndex((line) => /^Script error:/i.test(line.trim()));
    if (errorIndex >= 0) {
      error = sectionLines
        .slice(errorIndex)
        .join("\n")
        .replace(/^Script error:\s*/i, "")
        .trim();
      sectionLines.length = errorIndex;
    }
    const blocks = splitBlocks(sectionLines);
    if (!blocks.length && !section.title) continue;
    sections.push({ title: section.title, blocks });
  }
  return { status, wallTime, error, sections };
}

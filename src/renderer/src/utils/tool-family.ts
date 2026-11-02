/**
 * 工具族：没有专属卡片的工具（find / ls、browser_*、tool_search、MCP …）
 * 都走 generic 卡片，这里统一给出它们的图标族与结果摘要口径。
 */

import { parseJsonPayload } from "./json-tree";
import { isPathListTool, pathListFromOutput } from "./structured-text";
import type { Messages } from "../i18n";

export type ToolFamily =
  | "browser"
  | "mcp"
  | "toolSearch"
  | "codemode"
  | "pathList"
  | "generic";

export function toolFamily(toolName: string): ToolFamily {
  const name = toolName.toLowerCase();
  if (name.startsWith("browser_")) return "browser";
  if (name.startsWith("mcp__")) return "mcp";
  if (name === "tool_search") return "toolSearch";
  if (name === "codemode") return "codemode";
  if (isPathListTool(name)) return "pathList";
  return "generic";
}

/** 结果里能数出来的量：清单条目 / 浏览器元素 / 搜索到的工具。 */
export type ToolResultCount = {
  count: number;
  unit: "items" | "elements" | "tools";
};

function arrayLength(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function recordValue(data: unknown, key: string): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return (data as Record<string, unknown>)[key];
}

/**
 * generic 卡片的量级摘要：路径清单数条目、browser_* 数元素、tool_search 数的工具。
 * 文案由渲染层按当前语言格式化。
 */
export function toolResultCount(
  toolName: string,
  preview: string | null,
  structured: unknown,
): ToolResultCount | null {
  const text = preview ?? "";
  switch (toolFamily(toolName)) {
    case "pathList": {
      const entries = pathListFromOutput(text, toolName);
      return entries ? { count: entries.length, unit: "items" } : null;
    }
    case "browser": {
      const data = structured ?? parseJsonPayload(text);
      const count = arrayLength(recordValue(data, "elements"));
      return count == null ? null : { count, unit: "elements" };
    }
    case "toolSearch": {
      const match = /Loaded (\d+) tools?/.exec(text);
      return match ? { count: Number(match[1]), unit: "tools" } : null;
    }
    default:
      return null;
  }
}

/** 量级文案按当前语言格式化：清单条目 / 浏览器元素 / 搜索到的工具。 */
export function toolCountLabel(t: Messages, count: ToolResultCount): string {
  if (count.unit === "elements") return t.toolResultElements(count.count);
  if (count.unit === "tools") return t.toolResultTools(count.count);
  return t.toolBodyPathCount(count.count);
}

/** browser 结果头部：当前页 url 与标题。 */
export type BrowserResultHead = {
  url: string | null;
  title: string | null;
};

export function browserResultHead(data: unknown): BrowserResultHead {
  const url = recordValue(data, "url");
  const title = recordValue(data, "title");
  return {
    url: typeof url === "string" && url ? url : null,
    title: typeof title === "string" && title ? title : null,
  };
}

/** `mcp__server__tool` → server；不是 MCP 名字时返回 null。 */
export function mcpServerName(toolName: string): string | null {
  const parts = toolName.split("__");
  if (parts[0]?.toLowerCase() !== "mcp" || parts.length < 3) return null;
  return parts[1] || null;
}

/** xd:// 设备调用还原：`write xd://<device>` 的卡片按被挂载工具本身展示。 */

import { isRecord, toolPathFromArgs } from "./tool-args";
import { parseJsonPayload } from "./json-tree";

const XD_DEVICE_PATH_RE = /^xd:\/\/([^/?#]+)$/i;
const XDEV_TRANSPORT_TOOLS: Record<string, true> = { read: true, write: true };

export type ResolvedXdevCall = {
  toolName: string;
  args: unknown;
  result: unknown;
};

type XdevDispatch = {
  tool: string;
  mode: "help" | "execute";
  args: Record<string, unknown> | null;
  inner: unknown;
};

/** `xd://<device>` 的设备名；根目录、文档 topic 与其它 URL 返回 null。 */
function xdevDeviceName(path: string | null): string | null {
  const match = path ? XD_DEVICE_PATH_RE.exec(path.trim()) : null;
  return match?.[1] ?? null;
}

/** 设备写入的展示名：设备名；普通写入保持工具原名。 */
export function toolDisplayName(
  toolName: string,
  args: unknown,
  result?: unknown,
): string {
  if (toolName.toLowerCase() !== "write") return toolName;
  return (
    xdevDeviceName(toolPathFromArgs(args)) ??
    xdevDispatchFromResult(result)?.tool ??
    toolName
  );
}

function xdevDispatchFromResult(result: unknown): XdevDispatch | null {
  if (!isRecord(result) || !isRecord(result.details)) return null;
  const raw = result.details.xdev;
  if (!isRecord(raw) || typeof raw.tool !== "string" || !raw.tool) return null;
  return {
    tool: raw.tool,
    mode: raw.mode === "help" ? "help" : "execute",
    args: isRecord(raw.args) ? raw.args : null,
    inner: raw.inner,
  };
}

/** 流式期间还没有 dispatch 元数据时，从写入内容里取出被调用的参数。 */
function xdevArgsFromWrite(args: unknown): unknown {
  if (!isRecord(args) || typeof args.content !== "string") return null;
  return parseJsonPayload(args.content);
}

/** 被挂载工具自己的结果形状：write 的 details 里包着 dispatch，真正的 details 在 dispatch.inner。 */
function innerResult(result: unknown, dispatch: XdevDispatch): unknown {
  const content = isRecord(result) && Array.isArray(result.content) ? result.content : [];
  const details = dispatch.mode === "execute" ? dispatch.inner : undefined;
  return {
    content,
    ...(details !== undefined ? { details } : {}),
    ...(isRecord(result) && result.isError === true ? { isError: true } : {}),
  };
}

/** `write xd://<device>` → 被挂载工具的名称、参数与结果；普通调用返回 null。 */
export function resolveXdevToolCall(
  toolName: string,
  args: unknown,
  result: unknown,
): ResolvedXdevCall | null {
  if (toolName.toLowerCase() !== "write") return null;
  const dispatch = xdevDispatchFromResult(result);
  const target = xdevDeviceName(toolPathFromArgs(args)) ?? dispatch?.tool ?? null;
  if (!target || XDEV_TRANSPORT_TOOLS[target.toLowerCase()]) return null;
  return {
    toolName: dispatch?.tool ?? target,
    args: dispatch?.args ?? xdevArgsFromWrite(args) ?? null,
    result: dispatch ? innerResult(result, dispatch) : result,
  };
}

/** 把 omp 的 AgentMessage[] 归一化成桌面可渲染的子代理对话。 */

import type { AgentTranscriptEntry } from "./protocol";

const MAX_ENTRIES = 200;
const MAX_TEXT = 4000;
const MAX_PROMPT_TEXT = 16000;
const MAX_THINKING = 2000;
const MAX_ARGS = 600;
/** diff/patch 与编辑正文必须完整到足以计算统计，不能按参数预览的 600 字符裁剪。 */
const MAX_WIDE_TEXT = 20_000;

const WIDE_TEXT_KEYS: Record<string, true> = {
  patch: true,
  diff: true,
  content: true,
  oldText: true,
  newText: true,
  old_string: true,
  new_string: true,
};

type ToolEntry = Extract<AgentTranscriptEntry, { kind: "tool" }>;

export type NormalizeAgentOptions = {
  /** 运行中的 agent：尚无结果的工具调用保留 pending，渲染成进行中。 */
  live?: boolean;
};

export type NormalizedAgentTranscript = {
  entries: AgentTranscriptEntry[];
  /** 条目超过上限，早期对话已被裁掉。 */
  truncated: boolean;
};

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function blocksOf(message: Record<string, unknown>): unknown[] {
  return Array.isArray(message.content) ? message.content : [];
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null || Array.isArray(block)) continue;
    const candidate = block as { type?: unknown; text?: unknown };
    if (candidate.type !== "text" || typeof candidate.text !== "string") continue;
    if (candidate.text.trim()) parts.push(candidate.text);
  }
  return parts.join("\n");
}

function thinkingFromBlocks(blocks: readonly unknown[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (typeof block !== "object" || block === null || Array.isArray(block)) continue;
    const candidate = block as { type?: unknown; thinking?: unknown };
    if (candidate.type !== "thinking" || typeof candidate.thinking !== "string") continue;
    if (candidate.thinking.trim()) parts.push(candidate.thinking);
  }
  return parts.join("\n");
}

function argsText(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return clip(value, MAX_ARGS);
  try {
    return clip(JSON.stringify(value), MAX_ARGS);
  } catch {
    return undefined;
  }
}

/** 工具参数/结果只保留卡片需要的字段，长字符串与深层结构按上限裁剪。 */
function compactValue(value: unknown, depth = 0, key?: string): unknown {
  if (depth > 4) return "[…]";
  if (typeof value === "string") {
    return clip(value, key && WIDE_TEXT_KEYS[key] ? MAX_WIDE_TEXT : MAX_ARGS);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => compactValue(item, depth + 1));
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [entryKey, item] of Object.entries(value)) {
      if (count >= 50) break;
      out[entryKey] = compactValue(item, depth + 1, entryKey);
      count += 1;
    }
    return out;
  }
  return value;
}

/**
 * 工具调用与结果合并成一条：assistant 的 ToolCall 先落条目，随后的
 * toolResult 按 toolCallId 补上结果；找不到调用记录的结果单独成条。
 */
export function normalizeAgentTranscript(
  messages: readonly unknown[],
  opts?: NormalizeAgentOptions,
): NormalizedAgentTranscript {
  const entries: AgentTranscriptEntry[] = [];
  const calls = new Map<string, ToolEntry>();
  const live = opts?.live === true;

  for (const message of messages) {
    if (typeof message !== "object" || message === null || Array.isArray(message)) continue;
    const record = message as Record<string, unknown>;
    const timestamp = typeof record.timestamp === "number" ? record.timestamp : undefined;

    if (record.role === "user") {
      const text = textFromContent(record.content);
      if (text.trim()) {
        entries.push({
          kind: "message",
          role: "user",
          text: clip(text, MAX_PROMPT_TEXT),
          ...(timestamp ? { timestamp } : {}),
        });
      }
      continue;
    }

    if (record.role === "assistant") {
      const blocks = blocksOf(record);
      const text = textFromContent(record.content);
      const thinking = thinkingFromBlocks(blocks);
      if (text.trim() || thinking.trim()) {
        entries.push({
          kind: "message",
          role: "assistant",
          text: clip(text, MAX_TEXT),
          ...(thinking.trim() ? { thinking: clip(thinking, MAX_THINKING) } : {}),
          ...(timestamp ? { timestamp } : {}),
        });
      }
      for (const block of blocks) {
        if (typeof block !== "object" || block === null || Array.isArray(block)) continue;
        const call = block as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown };
        if (call.type !== "toolCall") continue;
        const toolName = typeof call.name === "string" && call.name ? call.name : "tool";
        const entry: ToolEntry = {
          kind: "tool",
          toolName,
          ...(live ? { pending: true } : {}),
          ...(typeof call.id === "string" && call.id ? { callId: call.id } : {}),
          ...(call.arguments != null
            ? { args: argsText(call.arguments), argsValue: compactValue(call.arguments) }
            : {}),
          ...(timestamp ? { timestamp } : {}),
        };
        entries.push(entry);
        if (typeof call.id === "string" && call.id) calls.set(call.id, entry);
      }
      continue;
    }

    if (record.role === "toolResult") {
      const toolName =
        typeof record.toolName === "string" && record.toolName ? record.toolName : "tool";
      const text = clip(textFromContent(record.content), MAX_TEXT);
      const isError = record.isError === true;
      const details = record.details != null ? compactValue(record.details) : undefined;
      const callId = typeof record.toolCallId === "string" ? record.toolCallId : "";
      const answered = callId ? calls.get(callId) : undefined;
      if (answered) {
        answered.pending = false;
        if (text) answered.text = text;
        if (details !== undefined) answered.resultDetails = details;
        if (isError) answered.isError = true;
        continue;
      }
      if (text || details !== undefined || isError) {
        entries.push({
          kind: "tool",
          toolName,
          ...(callId ? { callId } : {}),
          ...(text ? { text } : {}),
          ...(details !== undefined ? { resultDetails: details } : {}),
          ...(isError ? { isError: true } : {}),
          ...(timestamp ? { timestamp } : {}),
        });
      }
    }
  }

  if (entries.length <= MAX_ENTRIES) return { entries, truncated: false };
  const prompt = entries.find(
    (entry) => entry.kind === "message" && entry.role === "user",
  );
  const tail = entries.slice(-(MAX_ENTRIES - (prompt ? 1 : 0)));
  const kept =
    prompt && !tail.includes(prompt) ? [prompt, ...tail] : entries.slice(-MAX_ENTRIES);
  return { entries: kept, truncated: true };
}

export function normalizeAgentMessages(
  messages: readonly unknown[],
  opts?: NormalizeAgentOptions,
): AgentTranscriptEntry[] {
  return normalizeAgentTranscript(messages, opts).entries;
}

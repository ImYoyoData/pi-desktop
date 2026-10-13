/**
 * 消息行尾部的指标文本（时长 / token / 模型名）—— 纯函数，可直接单测格式化边界。
 */

import type { ChatMessage } from "../stores/chat-reducer";
import type { SessionContextUsage } from "../../../shared/protocol";
import { t } from "@renderer/i18n";
import { thinkingLevelLabel } from "./thinking-level";

export type AssistantMessage = Extract<ChatMessage, { role: "assistant" }>;
export type ToolMessage = Extract<ChatMessage, { role: "tool" }>;

/** 折叠标题里用短串展示，hover 提示里用完整串。 */
export type CompactDetail = { compact: string; detail: string };

export type ToolStatusLabel = {
  type: "default" | "success" | "error" | "info";
  label: string;
};

export function formatElapsedMs(ms: number): string {
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return rem ? `${min}m ${rem}s` : `${min}m`;
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** 模型目录 → `provider/id` 显示名映射；取不到目录时调用方退回原始 id。 */
export function buildModelNameMap(
  available: readonly { provider: string; id: string; name: string }[],
): Record<string, string> {
  return Object.fromEntries(available.map((m) => [`${m.provider}/${m.id}`, m.name]));
}

export function toolStatus(msg: ToolMessage): ToolStatusLabel {
  if (msg.streaming) return { type: "info", label: t.toolRunning };
  if (msg.isError) return { type: "error", label: t.toolError };
  return { type: "success", label: t.toolDone };
}

/**
 * "12.4s · 1.2k tok · 96 tok/s"：一轮完成的耗时与 token。
 * 时长与 token 都没有时返回 null，调用方据此不渲染该段。
 */
export function assistantStats(msg: AssistantMessage): CompactDetail | null {
  const durMs = msg.durationMs;
  const total = msg.usage?.totalTokens;
  const durLabel = durMs != null && durMs > 0 ? formatElapsedMs(durMs) : null;
  const tokLabel = total != null && total > 0 ? formatTokenCount(total) : null;
  if (!durLabel && !tokLabel) return null;

  const perSec =
    durMs != null && durMs > 0 && total != null && total > 0
      ? Math.round(total / (durMs / 1000))
      : null;
  return {
    compact: [durLabel, tokLabel, perSec != null ? `${perSec}/s` : null]
      .filter(Boolean)
      .join(" · "),
    detail: t.assistantStatsTitle(
      durLabel ?? "—",
      total != null ? total.toLocaleString() : "—",
      perSec != null ? String(perSec) : "—",
    ),
  };
}

/**
 * "Claude Sonnet 4.5 · High"：本轮结束使用的模型与思考级别。
 * 思考级别为 off 时不展示；模型名缺失时退回原始 model id。
 */
export function assistantModelDetail(
  msg: AssistantMessage,
  ctxUsage: SessionContextUsage | null,
  modelNames: Record<string, string>,
): CompactDetail | null {
  const model = msg.model ?? ctxUsage?.model ?? null;
  const rawLevel = msg.thinkingLevel ?? ctxUsage?.thinkingLevel ?? null;
  const name = model
    ? (modelNames[`${model.provider}/${model.id}`] ?? model.id)
    : null;
  const level = rawLevel && rawLevel !== "off" ? thinkingLevelLabel(rawLevel) : null;
  if (!name && !level) return null;
  return {
    compact: [name, level].filter(Boolean).join(" · "),
    detail: t.assistantModelTitle(name ?? "—", level ?? "—"),
  };
}
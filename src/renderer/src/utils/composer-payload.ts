/**
 * Composer 载荷的纯推导 —— 消息/队列项与输入框之间的文本与标签映射。
 *
 * 同一套 tag 判定原先在两处各写一遍（MessageList 重新编辑已发布气泡、
 * Composer 编辑队列项），这里抽成一份，两边共用。
 */

import { isLegacyModeTagKind } from "../../../shared/injected-blocks";

export type ComposerTag = {
  url: string;
  host?: string;
  label?: string;
  content?: string;
  kind?: string;
};

export type ComposerTagAction =
  | { kind: "file"; value: string }
  | { kind: "url"; value: string }
  | { kind: "citation"; url: string; text: string };

function tagText(tag: ComposerTag): string {
  return tag.content || tag.label || "";
}

/**
 * 标签 → 输入框动作序列。
 *
 * 判定顺序：旧版模式标记直接跳过（模式功能已下线）；file 用
 * content/label/url 兜底；url 接受显式 kind 或无 kind 但形似 http(s)；
 * 其余（含 element / 无 kind 的普通链接）降级为引用。
 *
 * 引用去重需要跨 citations 与 tags 的共享状态，由调用方处理。
 */
export function planComposerTags(tags: readonly ComposerTag[] | undefined): ComposerTagAction[] {
  const out: ComposerTagAction[] = [];
  for (const tag of tags ?? []) {
    if (isLegacyModeTagKind(tag.kind)) {
      continue;
    }
    if (tag.kind === "file") {
      out.push({ kind: "file", value: tag.content || tag.label || tag.url });
      continue;
    }
    if (tag.kind === "url" || (!tag.kind && /^https?:\/\//i.test(tag.url))) {
      out.push({ kind: "url", value: tag.url });
      continue;
    }
    out.push({ kind: "citation", url: tag.url, text: tagText(tag) });
  }
  return out;
}

/**
 * 队列项 / 待发送载荷的消息正文。
 * 纯图片或纯标签的消息用单个空格占位：text 必填，但正文要为空。
 */
export function queueMessageText(payload: {
  displayText?: string;
  text: string;
  hasVisual: boolean;
}): string {
  if (payload.displayText) return payload.displayText;
  return payload.hasVisual || !payload.text ? " " : payload.text;
}

/** 下发给模型的正文；视觉载荷或空正文同样需要空格占位。 */
export function agentTextFor(text: string, hasVisual: boolean): string {
  return text || (hasVisual ? " " : " ");
}

/** 上屏气泡的正文：单个空格是占位符，展示时还原成空。 */
export function displayTextFor(text: string): string {
  return text === " " ? "" : text;
}

export function queueItemHasContent(item: {
  text: string;
  images?: unknown[];
  citations?: unknown[];
  elementTags?: unknown[];
}): boolean {
  return Boolean(
    item.text.trim() ||
      item.images?.length ||
      item.citations?.length ||
      item.elementTags?.length,
  );
}

/**
 * 把 URL 引用嵌成文本，让它能随 steer 消息下发（队列本身是纯文本通道）。
 * 无有效引用时原样返回。
 */
export function steerTextWithCitations(item: {
  agentText?: string;
  text: string;
  citations?: { url?: string; text?: string }[];
}): string {
  const base = item.agentText || item.text || " ";
  const cites = (item.citations ?? []).filter((c) => c && c.url);
  if (!cites.length) return base;
  const lines = cites.map((c) => `- ${c.url}${c.text ? ` (${c.text.slice(0, 160)})` : ""}`);
  return [base, "", "References:", ...lines].join("\n");
}

/** 会话标题种子：正文优先，其次第一个附件标签。 */
export function titleSeedFor(
  displayText: string,
  firstTag?: { content?: string; label?: string },
): string {
  return displayText || firstTag?.content || firstTag?.label || "";
}
/**
 * Pure session-jsonl → UI history parsing (no Electron / no IPC).
 * Used by the main process and by session-history-worker off the UI thread.
 *
 * Pagination (`parseSessionHistoryPageFromJsonl`) builds the leaf-path index
 * once, then only materializes images for the requested window — so switching
 * huge sessions does not ship megabytes of unused base64 over IPC.
 */
import { stripComposerModePreamble } from "../shared/composer-modes";
import { stripThinkingLanguageBlock } from "../shared/thinking-language";
import {
  stripAttachedImagesBlock,
  stripSelectionCitationsBlock,
  type ChatMessageTag,
} from "../shared/chat-meta";
import type { SessionHistoryMessage, SessionHistoryPage } from "../shared/protocol";

type ParsedEntry = {
  id: string;
  parentId: string | null;
  timestamp: string;
  type: string;
  message?: Record<string, unknown>;
  /** model_change entries. */
  provider?: string;
  /** model_change entries. */
  modelId?: string;
  /** thinking_level_change entries. */
  thinkingLevel?: string;
};

type HistoryImage = { mimeType: string; dataUrl: string };

const MAX_UI_TEXT_CHARS = 24_000;
const MAX_HISTORY_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_IMAGE_BASE64_LENGTH = 12 * 1024 * 1024;

function truncateForUi(text: string, max = MAX_UI_TEXT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… (${text.length - max} more chars)`;
}

function truncateArgsForUi(args: unknown): unknown {
  if (args == null || typeof args !== "object") return args;
  try {
    const raw = JSON.stringify(args);
    if (raw.length <= MAX_UI_TEXT_CHARS) return args;
    return {
      _truncated: true,
      preview: `${raw.slice(0, MAX_UI_TEXT_CHARS)}… (${raw.length - MAX_UI_TEXT_CHARS} more chars)`,
    };
  } catch {
    return args;
  }
}

function textFromAgentMessage(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((part): part is { type: string; text: string } => {
      return Boolean(part && typeof part === "object" && (part as { type?: string }).type === "text");
    })
    .map((part) => part.text)
    .join("");
}

/** 助手消息本轮使用的模型：优先服务端返回的 responseModel，其次请求的 model。 */
function messageModel(
  message: Record<string, unknown>,
  fallback: { provider: string; id: string } | null,
): { provider: string; id: string } | null {
  const id =
    typeof message.responseModel === "string" && message.responseModel
      ? message.responseModel
      : typeof message.model === "string" && message.model
        ? message.model
        : "";
  const provider =
    typeof message.provider === "string" && message.provider
      ? message.provider
      : (fallback?.provider ?? "");
  if (!id || !provider) return fallback;
  return { provider, id };
}

/** Extract {input, output, totalTokens} from a persisted assistant usage object. */
function usageFromAgentMessage(message: Record<string, unknown>): {
  input?: number;
  output?: number;
  totalTokens?: number;
} | null {
  const usage = message.usage;
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const input = num(u.input);
  const output = num(u.output);
  const total = num(u.totalTokens) ?? num(u.total);
  if (input == null && output == null && total == null) return null;
  return {
    ...(input != null ? { input } : {}),
    ...(output != null ? { output } : {}),
    ...(total != null ? { totalTokens: total } : {}),
  };
}

function imagesFromAgentMessage(message: Record<string, unknown>): HistoryImage[] {
  const content = message.content;
  if (!Array.isArray(content)) return [];
  const out: HistoryImage[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const row = part as { type?: unknown; data?: unknown; mimeType?: unknown };
    if (row.type !== "image" || typeof row.data !== "string" || !row.data) continue;
    const mimeType =
      typeof row.mimeType === "string" && row.mimeType.trim() ? row.mimeType.trim() : "image/png";
    const dataUrl = row.data.startsWith("data:")
      ? row.data
      : `data:${mimeType};base64,${row.data}`;
    out.push({ mimeType, dataUrl });
  }
  return out;
}

/** Move image payloads into `pending` and drop them from the message object. */
function extractImagesToPending(
  entryId: string,
  message: Record<string, unknown>,
  pending: Map<string, HistoryImage[]>,
): void {
  const images = imagesFromAgentMessage(message);
  if (!images.length) return;
  pending.set(entryId, images);
  if (Array.isArray(message.content)) {
    message.content = message.content.filter((part) => {
      if (!part || typeof part !== "object") return true;
      return (part as { type?: unknown }).type !== "image";
    });
  }
}

function thinkingFromAgentMessage(message: Record<string, unknown>): string {
  const content = message.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: string; thinking: string } => {
      return (
        Boolean(part) &&
        typeof part === "object" &&
        (part as { type?: string }).type === "thinking" &&
        typeof (part as { thinking?: unknown }).thinking === "string"
      );
    })
    .map((part) => part.thinking)
    .join("");
}

function toolCallArgsFromAssistant(message: Record<string, unknown>): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const content = message.content;
  if (!Array.isArray(content)) return out;
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const row = part as { type?: unknown; id?: unknown; arguments?: unknown };
    if (row.type !== "toolCall" || typeof row.id !== "string" || !row.id) continue;
    out.set(row.id, row.arguments);
  }
  return out;
}

function findLeafId(entries: ParsedEntry[]): string | null {
  const hasChild = new Set<string>();
  for (const entry of entries) {
    if (entry.parentId) {
      hasChild.add(entry.parentId);
    }
  }
  const leaves = entries.filter((entry) => entry.id && !hasChild.has(entry.id));
  if (leaves.length === 0) {
    return null;
  }
  leaves.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return leaves[0]?.id ?? null;
}

function collectEntries(raw: string): {
  entries: ParsedEntry[];
  pendingImages: Map<string, HistoryImage[]>;
} {
  const entries: ParsedEntry[] = [];
  const pendingImages = new Map<string, HistoryImage[]>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof parsed.type !== "string" || typeof parsed.id !== "string") {
      continue;
    }
    const message =
      parsed.message && typeof parsed.message === "object"
        ? (parsed.message as Record<string, unknown>)
        : undefined;
    if (message) extractImagesToPending(parsed.id, message, pendingImages);
    entries.push({
      id: parsed.id,
      parentId: typeof parsed.parentId === "string" ? parsed.parentId : null,
      timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : "",
      type: parsed.type,
      message,
      ...(typeof parsed.provider === "string" ? { provider: parsed.provider } : {}),
      ...(typeof parsed.modelId === "string" ? { modelId: parsed.modelId } : {}),
      ...(typeof parsed.thinkingLevel === "string"
        ? { thinkingLevel: parsed.thinkingLevel }
        : {}),
    });
  }
  return { entries, pendingImages };
}

/** Build leaf-path UI messages without attaching image payloads. */
function buildMessagesFromEntries(
  entries: ParsedEntry[],
  pendingImages: Map<string, HistoryImage[]>,
  chatMeta?: { text: string; tags: ChatMessageTag[] }[],
): SessionHistoryMessage[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let leafId = findLeafId(entries);
  const pathIds: string[] = [];
  while (leafId) {
    pathIds.push(leafId);
    const entry = byId.get(leafId);
    leafId = entry?.parentId ?? null;
  }
  pathIds.reverse();

  const messages: SessionHistoryMessage[] = [];
  const toolCallArgsById = new Map<string, unknown>();
  let metaCursor = 0;
  let currentModel: { provider: string; id: string } | null = null;
  let currentThinkingLevel: string | null = null;
  // 当前轮起点（user 消息发出的时刻）；工具循环内多步 assistant 共用同一起点。
  let turnStartMs: number | null = null;
  for (const id of pathIds) {
    const entry = byId.get(id);
    if (!entry) continue;
    if (entry.type === "model_change") {
      if (entry.provider && entry.modelId) {
        currentModel = { provider: entry.provider, id: entry.modelId };
      }
      continue;
    }
    if (entry.type === "thinking_level_change") {
      if (entry.thinkingLevel) currentThinkingLevel = entry.thinkingLevel;
      continue;
    }
    if (entry.type !== "message" || !entry.message) {
      continue;
    }
    const role = entry.message.role;
    if (role === "user") {
      const rawText = textFromAgentMessage(entry.message);
      const hasImages = (pendingImages.get(entry.id)?.length ?? 0) > 0;
      const cleanText = stripComposerModePreamble(
        stripSelectionCitationsBlock(stripAttachedImagesBlock(rawText)),
      );
      const agentText = stripSelectionCitationsBlock(rawText);
      // 附件 chips 的 sidecar 按发送时文本（无思考语言块）写入，匹配前先剥离注入块。
      const metaText = stripThinkingLanguageBlock(agentText);
      let elementTags: ChatMessageTag[] | undefined;
      if (chatMeta && chatMeta.length > 0) {
        for (let i = metaCursor; i < chatMeta.length; i++) {
          if (stripThinkingLanguageBlock(chatMeta[i]!.text) === metaText) {
            elementTags = chatMeta[i]!.tags;
            metaCursor = i + 1;
            break;
          }
        }
      }
      const ts = entry.message.timestamp;
      if (typeof ts === "number" && Number.isFinite(ts) && ts > 0) {
        turnStartMs = ts;
      }
      if (cleanText || hasImages || elementTags) {
        messages.push({
          id: entry.id,
          role: "user",
          text: truncateForUi(cleanText),
          ...(elementTags ? { elementTags } : {}),
        });
      }
    } else if (role === "assistant") {
      for (const [callId, args] of toolCallArgsFromAssistant(entry.message)) {
        toolCallArgsById.set(callId, args);
      }
      const text = textFromAgentMessage(entry.message);
      const thinking = thinkingFromAgentMessage(entry.message);
      if (text || thinking) {
        const model = messageModel(entry.message, currentModel);
        const usage = usageFromAgentMessage(entry.message);
        const ts = entry.message.timestamp;
        const durationMs =
          turnStartMs != null && typeof ts === "number" && Number.isFinite(ts)
            ? Math.max(0, ts - turnStartMs)
            : null;
        messages.push({
          id: entry.id,
          role: "assistant",
          text: truncateForUi(text),
          ...(thinking ? { thinking: truncateForUi(thinking, 16_000) } : {}),
          ...(model ? { model } : {}),
          ...(currentThinkingLevel ? { thinkingLevel: currentThinkingLevel } : {}),
          ...(usage ? { usage } : {}),
          ...(durationMs != null && durationMs > 0 ? { durationMs } : {}),
        });
      }
    } else if (role === "toolResult") {
      const toolCallId =
        typeof entry.message.toolCallId === "string" ? entry.message.toolCallId : entry.id;
      const toolName =
        typeof entry.message.toolName === "string" && entry.message.toolName.trim()
          ? entry.message.toolName
          : "tool";
      const text = textFromAgentMessage(entry.message);
      const args = toolCallArgsById.get(toolCallId);
      messages.push({
        id: entry.id,
        role: "tool",
        toolCallId,
        toolName,
        text: truncateForUi(text),
        isError: Boolean(entry.message.isError),
        ...(args !== undefined ? { args: truncateArgsForUi(args) } : {}),
      });
    }
  }

  return messages;
}

/**
 * Walk newest→oldest applying the global image budget, but only attach payloads
 * for messages in `[start, end)`.
 */
function materializePageImages(
  all: SessionHistoryMessage[],
  pendingImages: Map<string, HistoryImage[]>,
  start: number,
  end: number,
  imageBudgetBytes: number,
): SessionHistoryMessage[] {
  let imageBudget = imageBudgetBytes;
  const pageImages = new Map<string, HistoryImage[]>();

  for (let i = all.length - 1; i >= 0; i--) {
    const msg = all[i]!;
    if (msg.role !== "user" || imageBudget <= 0) continue;
    const images = pendingImages.get(msg.id);
    if (!images?.length) continue;
    const kept: HistoryImage[] = [];
    for (const img of images) {
      if (img.dataUrl.length > MAX_IMAGE_BASE64_LENGTH) continue;
      if (img.dataUrl.length > imageBudget) break;
      kept.push(img);
      imageBudget -= img.dataUrl.length;
    }
    if (kept.length && i >= start && i < end) {
      pageImages.set(msg.id, kept);
    }
  }

  const slice = all.slice(start, end);
  if (!pageImages.size) return slice;
  return slice.map((msg) => {
    const images = pageImages.get(msg.id);
    if (!images || msg.role !== "user") return msg;
    return { ...msg, images };
  });
}

export type ParseSessionHistoryPageOpts = {
  limit: number;
  beforeId?: string | null;
  chatMeta?: { text: string; tags: ChatMessageTag[] }[];
  /** Override for tests — production uses the default 24MB budget. */
  imageBudgetBytes?: number;
};

/**
 * Paginated leaf-path history. Always computes `total` from the full path, but
 * only attaches image payloads for the returned window (global budget still
 * applied from the conversation end, matching full-parse semantics).
 */
export function parseSessionHistoryPageFromJsonl(
  raw: string,
  opts: ParseSessionHistoryPageOpts,
): SessionHistoryPage {
  const limit = Math.max(1, Math.min(1_000_000, opts.limit));
  const beforeId = opts.beforeId?.trim() || null;
  const imageBudgetBytes =
    typeof opts.imageBudgetBytes === "number" && opts.imageBudgetBytes > 0
      ? opts.imageBudgetBytes
      : MAX_HISTORY_IMAGE_BYTES;

  const { entries, pendingImages } = collectEntries(raw);
  const all = buildMessagesFromEntries(entries, pendingImages, opts.chatMeta);
  const total = all.length;

  if (total === 0) {
    pendingImages.clear();
    return { messages: [], hasMore: false, total: 0 };
  }

  let end = total;
  if (beforeId) {
    const idx = all.findIndex((m) => m.id === beforeId);
    if (idx < 0 || idx === 0) {
      pendingImages.clear();
      return { messages: [], hasMore: false, total };
    }
    end = idx;
  }

  const start = Math.max(0, end - limit);
  const messages = materializePageImages(all, pendingImages, start, end, imageBudgetBytes);
  pendingImages.clear();
  return {
    messages,
    hasMore: start > 0,
    total,
  };
}

/** Parse a session jsonl string (+ optional UI meta) into leaf-path UI messages. */
export function parseSessionHistoryJsonl(
  raw: string,
  chatMeta?: { text: string; tags: ChatMessageTag[] }[],
): SessionHistoryMessage[] {
  const { entries, pendingImages } = collectEntries(raw);
  const all = buildMessagesFromEntries(entries, pendingImages, chatMeta);
  const messages = materializePageImages(
    all,
    pendingImages,
    0,
    all.length,
    MAX_HISTORY_IMAGE_BYTES,
  );
  pendingImages.clear();
  return messages;
}

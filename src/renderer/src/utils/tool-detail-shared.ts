/** 详情卡适配器的共用读取与构造工具。 */

import type {
  DetailChip,
  DetailFlag,
  DetailItem,
  DetailLabel,
  DetailParseOptions,
  DetailResultParts,
  DetailSection,
  DetailToolCard,
} from "./tool-detail-types";

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function rawText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function textValue(value: unknown): string | null {
  const text = rawText(value).trim();
  return text || null;
}

export function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function firstLine(text: string | null, max = 90): string | null {
  if (!text) return null;
  const line = text.split("\n").find((entry) => entry.trim())?.trim() ?? "";
  if (!line) return null;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function textSection(
  value: string | null | undefined,
  label: DetailLabel | null = "output",
  title?: string,
): DetailSection | null {
  const text = value?.trim() ?? "";
  return text ? { kind: "text", label, title, text } : null;
}

export function codeSection(
  code: string | null | undefined,
  lang: string,
  label: DetailLabel | null = "code",
  title?: string,
): DetailSection | null {
  const text = code?.trim() ?? "";
  return text ? { kind: "code", label, title, code: text, lang } : null;
}

export function jsonSection(value: unknown, label: DetailLabel = "output"): DetailSection | null {
  if (value == null) return null;
  if (typeof value === "object" && !Object.keys(record(value)).length && !Array.isArray(value)) {
    return null;
  }
  return { kind: "json", label, value };
}

export function item(
  title: string,
  subtitle?: string | null,
  body?: string | null,
  tone?: DetailItem["tone"],
): DetailItem {
  return { title, subtitle, body, tone };
}

export function compactParts(parts: Array<string | null | undefined>): string | null {
  const text = parts.map((part) => part?.trim()).filter(Boolean).join(" · ");
  return text || null;
}

export function buildCard(
  tool: string,
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
  init: {
    target?: string | null;
    summary?: string | null;
    chips?: DetailChip[];
    flags?: DetailFlag[];
    sections?: Array<DetailSection | null>;
    transcripts?: Array<{ agentId: string; label: string }>;
  },
): DetailToolCard {
  const flags = [...(init.flags ?? [])];
  if (opts.isError && !flags.includes("failed")) flags.push("failed");
  return {
    kind: "detail",
    tool,
    target: init.target ?? null,
    summary: init.summary ?? null,
    chips: init.chips ?? [],
    flags,
    sections: (init.sections ?? []).filter(
      (section): section is DetailSection => section != null,
    ),
    transcripts: init.transcripts ?? [],
    images: parts.images,
    args,
    durationMs: opts.durationMs ?? null,
  };
}

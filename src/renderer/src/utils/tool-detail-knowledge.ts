/** 联网搜索与长期记忆类工具的详情卡。 */

import {
  arrayValue,
  buildCard,
  codeSection,
  compactParts,
  firstLine,
  item,
  numberValue,
  record,
  textSection,
  textValue,
} from "./tool-detail-shared";
import type {
  DetailLink,
  DetailParseOptions,
  DetailResultParts,
  DetailToolCard,
} from "./tool-detail-types";

export function webSearchCard(
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const details = parts.details ?? {};
  const response = record(details.response);
  const sources = arrayValue(response.sources).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object",
  );
  const related = arrayValue(response.relatedQuestions)
    .map((entry) => textValue(entry))
    .filter((entry): entry is string => entry != null);
  const links = sources.flatMap((source): DetailLink[] => {
    const url = textValue(source.url);
    if (!url) return [];
    return [
      {
        title: textValue(source.title) ?? url,
        url,
        snippet: textValue(source.snippet),
        meta: textValue(source.publishedDate) ?? textValue(source.author),
      },
    ];
  });
  const provider = textValue(response.provider);
  const model = textValue(response.model);
  return buildCard("web_search", args, parts, opts, {
    target: textValue(data.query),
    summary: compactParts([provider, model]),
    chips: [
      ...(provider ? [{ kind: "text" as const, text: provider }] : []),
      ...(links.length
        ? [{ kind: "count" as const, unit: "sources" as const, value: links.length }]
        : []),
    ],
    flags: details.error || opts.isError ? ["failed"] : [],
    sections: [
      textSection(textValue(response.answer), "answer"),
      links.length ? { kind: "links", label: "sources", items: links } : null,
      related.length
        ? { kind: "items", label: "questions", items: related.map((entry) => item(entry)) }
        : null,
      textSection(parts.text),
    ],
  });
}

export function retainCard(
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const details = parts.details ?? {};
  const items = arrayValue(data.items).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object",
  );
  const contents = items
    .map((entry) => textValue(entry.content))
    .filter((entry): entry is string => entry != null);
  const count = numberValue(details.count) ?? contents.length;
  return buildCard("retain", args, parts, opts, {
    target: firstLine(contents[0] ?? null),
    summary: firstLine(parts.text),
    chips: count ? [{ kind: "count", unit: "items", value: count }] : [],
    sections: [
      contents.length
        ? {
            kind: "items",
            label: "memory",
            items: items.map((entry, index) =>
              item(contents[index] ?? `Memory ${index + 1}`, textValue(entry.context)),
            ),
          }
        : null,
      textSection(parts.text),
    ],
  });
}

export function queryMemoryCard(
  tool: "recall" | "reflect",
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const query = textValue(data.query);
  const match = /Found (\d+) relevant/i.exec(parts.text);
  const count = match ? Number(match[1]) : null;
  return buildCard(tool, args, parts, opts, {
    target: query,
    summary: firstLine(parts.text),
    chips: count != null ? [{ kind: "count", unit: "items", value: count }] : [],
    flags: opts.isError ? ["failed"] : [],
    sections: [textSection(parts.text, "memory")],
  });
}

export function memoryEditCard(
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const op = textValue(data.op);
  const id = textValue(data.id);
  return buildCard("memory_edit", args, parts, opts, {
    target: id ?? op,
    summary: op,
    chips: op ? [{ kind: "text", text: op }] : [],
    flags: opts.isError ? ["failed"] : [],
    sections: [codeSection(textValue(data.content), "markdown"), textSection(parts.text, "memory")],
  });
}

export function learnCard(
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const skill = record(data.skill);
  const skillName = textValue(skill.name);
  return buildCard("learn", args, parts, opts, {
    target: firstLine(textValue(data.memory)),
    summary: null,
    chips: skillName ? [{ kind: "text", text: skillName }] : [],
    flags: opts.isError ? ["failed"] : [],
    sections: [
      textSection(textValue(data.memory), "memory"),
      textSection(textValue(data.context), "details"),
      textSection(textValue(skill.description), "skill"),
      codeSection(textValue(skill.body), "markdown", "skill"),
      textSection(parts.text),
    ],
  });
}

export function manageSkillCard(
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const action = textValue(data.action);
  const name = textValue(data.name);
  return buildCard("manage_skill", args, parts, opts, {
    target: name,
    summary: action,
    chips: [
      ...(action ? [{ kind: "text" as const, text: action }] : []),
      ...(name ? [{ kind: "text" as const, text: name }] : []),
    ],
    flags: opts.isError ? ["failed"] : [],
    sections: [
      textSection(textValue(data.description), "skill"),
      codeSection(textValue(data.body), "markdown", "skill"),
      textSection(parts.text),
    ],
  });
}

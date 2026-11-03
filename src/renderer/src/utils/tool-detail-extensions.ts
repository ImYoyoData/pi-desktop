/** 扩展与动态工具的详情卡：脚本、工具搜索、浏览器、MCP、桌机控制。 */

import { languageFromPath } from "./editor-lang";
import { parseScriptReport } from "./structured-text";
import {
  arrayValue,
  buildCard,
  codeSection,
  compactParts,
  firstLine,
  jsonSection,
  rawText,
  record,
  textSection,
  textValue,
} from "./tool-detail-shared";
import type {
  DetailParseOptions,
  DetailResultParts,
  DetailSection,
  DetailToolCard,
} from "./tool-detail-types";

export function codemodeCard(
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const report = parseScriptReport(parts.text);
  const sections: Array<DetailSection | null> = [];
  if (report) {
    for (const section of report.sections) {
      for (const block of section.blocks) {
        if (block.kind === "code") {
          sections.push(
            codeSection(
              block.code,
              languageFromPath(block.path),
              "code",
              section.title ?? block.path,
            ),
          );
        } else if (block.kind === "console") {
          sections.push(textSection(block.lines.join("\n"), "output", section.title ?? undefined));
        } else {
          sections.push(textSection(block.text, "output", section.title ?? undefined));
        }
      }
    }
    sections.push(textSection(report.error, "output"));
  } else {
    sections.push(textSection(parts.text));
  }
  const code = textValue(data.code);
  return buildCard("codemode", args, parts, opts, {
    target: firstLine(code),
    summary: report ? null : firstLine(parts.text),
    chips: report
      ? [
          { kind: "count", unit: "items", value: report.sections.length },
          ...(report.wallTime != null
            ? [{ kind: "text" as const, text: `${report.wallTime}s` }]
            : []),
        ]
      : [],
    flags:
      report?.status === "failed" || opts.isError
        ? ["failed"]
        : report?.status === "completed"
          ? ["ok"]
          : [],
    sections,
  });
}

export function toolSearchCard(
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const match = /Loaded (\d+) tools?/i.exec(parts.text);
  const count = match ? Number(match[1]) : null;
  return buildCard("tool_search", args, parts, opts, {
    target: textValue(data.query),
    summary: firstLine(parts.text),
    chips: count != null ? [{ kind: "count", unit: "tools", value: count }] : [],
    flags: opts.isError ? ["failed"] : [],
    sections: [textSection(parts.text)],
  });
}

export function browserCard(
  tool: string,
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const details = parts.details ?? {};
  const structured = record(parts.structured);
  const value = details.value ?? parts.structured;
  const valueRecord = record(value);
  const structuredElements = arrayValue(structured.elements);
  const elements = structuredElements.length
    ? structuredElements
    : arrayValue(valueRecord.elements);
  const screenshots = arrayValue(details.screenshots);
  const url =
    textValue(structured.url) ??
    textValue(details.url) ??
    textValue(valueRecord.url) ??
    textValue(record(args).url);
  const title = textValue(structured.title) ?? textValue(valueRecord.title);
  const action = textValue(details.action);
  const name = textValue(details.name);
  return buildCard(tool, args, parts, opts, {
    target: url ?? title,
    summary: compactParts([action, name, title]),
    chips: [
      ...(action ? [{ kind: "text" as const, text: action }] : []),
      ...(elements.length
        ? [{ kind: "count" as const, unit: "items" as const, value: elements.length }]
        : []),
      ...(screenshots.length
        ? [{ kind: "count" as const, unit: "items" as const, value: screenshots.length }]
        : []),
    ],
    flags: opts.isError ? ["failed"] : [],
    sections: [jsonSection(value), textSection(parts.text)],
  });
}

export function mcpCard(
  tool: string,
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const details = parts.details ?? {};
  const structured = parts.structured ?? details.structuredContent;
  const server = tool.split("__")[1] ?? null;
  const target =
    textValue(data.path) ??
    textValue(data.file_path) ??
    textValue(data.filePath) ??
    textValue(data.query) ??
    textValue(data.url) ??
    textValue(data.pattern) ??
    textValue(data.command) ??
    firstLine(rawText(data.code));
  return buildCard(tool, args, parts, opts, {
    target,
    summary: server,
    chips: server ? [{ kind: "text", text: server }] : [],
    flags: opts.isError ? ["failed"] : [],
    sections: [jsonSection(structured), textSection(parts.text)],
  });
}

export function computerCard(
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const details = parts.details ?? {};
  const screenshots = arrayValue(details.screenshots);
  const action = textValue(data.action);
  return buildCard("computer", args, parts, opts, {
    target: action ?? firstLine(rawText(data.code)),
    summary: compactParts([textValue(details.backend), firstLine(parts.text)]),
    chips: screenshots.length
      ? [{ kind: "count", unit: "items", value: screenshots.length }]
      : [],
    flags: opts.isError ? ["failed"] : [],
    sections: [jsonSection(details.value), textSection(parts.text)],
  });
}

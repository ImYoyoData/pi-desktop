/** 仓库、语言服务与会话状态类工具的详情卡。 */

import {
  buildCard,
  compactParts,
  firstLine,
  item,
  numberValue,
  record,
  textSection,
  textValue,
} from "./tool-detail-shared";
import type {
  DetailChip,
  DetailFlag,
  DetailItem,
  DetailParseOptions,
  DetailResultParts,
  DetailToolCard,
} from "./tool-detail-types";

export function githubCard(
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const details = parts.details ?? {};
  const op = textValue(data.op);
  const repo = textValue(details.repo) ?? textValue(data.repo);
  const prValue = data.pr;
  const prList = Array.isArray(prValue)
    ? prValue
    : prValue == null
      ? []
      : [prValue];
  const pr = prList
    .map((entry) => textValue(entry))
    .filter((entry): entry is string => entry != null)
    .join(", ");
  const branch = textValue(details.branch);
  const status = textValue(details.status);
  const conclusion = textValue(details.conclusion);
  const filePath = textValue(data.path);
  const run =
    textValue(data.run) ??
    (numberValue(details.runId) != null ? String(details.runId) : null);
  const repoOrPr = repo ?? (pr || run || textValue(data.query) || null);
  const target = filePath ? `${repo ?? ""}${repo ? ":" : ""}${filePath}` : repoOrPr;
  const chips: DetailChip[] = [];
  if (op) chips.push({ kind: "text", text: op });
  if (repo) chips.push({ kind: "text", text: repo });
  if (pr) chips.push({ kind: "text", text: pr });
  if (filePath) chips.push({ kind: "text", text: filePath });
  if (run) chips.push({ kind: "text", text: run });
  if (branch) chips.push({ kind: "text", text: branch });
  if (status) chips.push({ kind: "text", text: status });
  if (conclusion) chips.push({ kind: "text", text: conclusion });
  return buildCard("github", args, parts, opts, {
    target,
    summary: compactParts([op, repo, status]),
    chips,
    flags: opts.isError ? ["failed"] : [],
    sections: [textSection(parts.text)],
  });
}

export function lspCard(
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const details = parts.details ?? {};
  const action = textValue(details.action) ?? textValue(data.action);
  const server = textValue(details.serverName);
  const file = textValue(data.file);
  const line = numberValue(data.line);
  const target =
    (file ? `${file}${line != null ? `:${line}` : ""}` : null) ??
    textValue(data.query) ??
    textValue(data.symbol);
  return buildCard("lsp", args, parts, opts, {
    target,
    summary: compactParts([action, server]),
    chips: [
      ...(action ? [{ kind: "text" as const, text: action }] : []),
      ...(server ? [{ kind: "text" as const, text: server }] : []),
    ],
    flags:
      details.success === false || opts.isError
        ? ["failed"]
        : details.success === true
          ? ["ok"]
          : [],
    sections: [textSection(parts.text)],
  });
}

export function checkpointCard(
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const details = parts.details ?? {};
  const goal = textValue(details.goal) ?? textValue(data.goal);
  return buildCard("checkpoint", args, parts, opts, {
    target: goal,
    summary: textValue(details.startedAt),
    sections: [textSection(goal, "goal"), textSection(parts.text)],
  });
}

export function rewindCard(
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const details = parts.details ?? {};
  const report = textValue(details.report) ?? textValue(data.report);
  return buildCard("rewind", args, parts, opts, {
    target: firstLine(report),
    summary: null,
    flags: details.rewound === true ? ["rewound"] : [],
    sections: [textSection(report, "report"), textSection(parts.text)],
  });
}

export function contextNotesCard(
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const details = parts.details ?? {};
  const notes = textValue(details.text) ?? textValue(data.text);
  const wrote = Object.hasOwn(data, "text");
  const bytes = numberValue(details.bytes);
  const flags: DetailFlag[] = wrote
    ? notes
      ? ["write"]
      : ["clear"]
    : ["read"];
  return buildCard("context_notes", args, parts, opts, {
    target: firstLine(notes),
    summary: null,
    chips: bytes != null ? [{ kind: "count", unit: "bytes", value: bytes }] : [],
    flags,
    sections: [textSection(notes, "notes"), textSection(parts.text)],
  });
}

export function newContextCard(
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const details = parts.details ?? {};
  return buildCard("new_context", args, parts, opts, {
    target: null,
    summary: null,
    flags: details.requested === true ? ["requested"] : [],
    sections: [textSection(parts.text)],
  });
}

export function securityScanCard(
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const details = parts.details ?? {};
  const action = textValue(details.action) ?? textValue(data.action);
  const operation = record(details.operation);
  const findingCount = numberValue(operation.findingCount);
  const items: DetailItem[] = [];
  for (const [key, label] of [
    ["operationId", "operation"],
    ["planId", "plan"],
    ["scanId", "scan"],
    ["phase", "phase"],
    ["jobId", "job"],
    ["error", "error"],
  ] as const) {
    const value = operation[key];
    if (value == null || value === "") continue;
    items.push(item(label, String(value)));
  }
  const finding = record(details.finding);
  if (textValue(finding.id)) {
    items.push(item("finding", textValue(finding.id), textValue(finding.validationStatus)));
  }
  const cloudScan = record(details.cloudScan);
  if (textValue(cloudScan.repositoryUrl)) {
    items.push(item("cloud scan", textValue(cloudScan.repositoryUrl)));
  }
  const imported = record(details.importedScan);
  if (textValue(imported.id)) {
    items.push(
      item(
        "imported scan",
        textValue(imported.id),
        numberValue(imported.findingCount) != null
          ? `${imported.findingCount} findings`
          : null,
      ),
    );
  }
  return buildCard("security_scan", args, parts, opts, {
    target:
      textValue(data.plan_id) ??
      textValue(data.operation_id) ??
      textValue(data.repository_url) ??
      textValue(data.repository_id),
    summary: compactParts([action, textValue(operation.phase)]),
    chips: [
      ...(action ? [{ kind: "text" as const, text: action }] : []),
      ...(findingCount != null
        ? [{ kind: "count" as const, unit: "findings" as const, value: findingCount }]
        : []),
    ],
    flags:
      details.cancelled === true
        ? ["cancelled"]
        : opts.isError
          ? ["failed"]
          : [],
    sections: [
      items.length ? { kind: "items", label: "details", items } : null,
      textSection(parts.text),
    ],
  });
}

/** 执行、子代理与调试类工具的详情卡。 */

import { formatDuration } from "./format-duration";
import {
  arrayValue,
  buildCard,
  codeSection,
  compactParts,
  firstLine,
  item,
  numberValue,
  rawText,
  record,
  textSection,
  textValue,
} from "./tool-detail-shared";
import type {
  DetailItem,
  DetailParseOptions,
  DetailResultParts,
  DetailSection,
  DetailToolCard,
} from "./tool-detail-types";

export function evalCard(
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const details = parts.details ?? {};
  const cells = arrayValue(details.cells).filter(
    (cell): cell is Record<string, unknown> => Boolean(cell) && typeof cell === "object",
  );
  const sections: Array<DetailSection | null> = [];
  const languages: string[] = [];
  let failed = Boolean(opts.isError);
  if (cells.length) {
    for (const cell of cells) {
      const language = rawText(cell.language) || "py";
      languages.push(language);
      const lang = language === "js" ? "javascript" : "python";
      const title = textValue(cell.title) ?? undefined;
      sections.push(codeSection(rawText(cell.code), lang, "code", title));
      sections.push(textSection(rawText(cell.output), "output", title));
      if (cell.status === "error" || (numberValue(cell.exitCode) ?? 0) !== 0) failed = true;
    }
  } else {
    const language = rawText(data.language) || "py";
    languages.push(language);
    sections.push(codeSection(rawText(data.code), language === "js" ? "javascript" : "python"));
    sections.push(textSection(parts.text));
  }
  const code = rawText(data.code) || rawText(cells[0]?.code);
  const uniqueLanguages = [...new Set(languages)];
  return buildCard("eval", args, parts, opts, {
    target: firstLine(code),
    summary: uniqueLanguages.join(", ") || null,
    chips: uniqueLanguages.map((language) => ({ kind: "text", text: language })),
    flags: failed ? ["failed"] : [],
    sections,
  });
}

export function taskCard(
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const details = parts.details ?? {};
  const results = arrayValue(details.results).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object",
  );
  const progressRows = arrayValue(details.progress).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object",
  );
  const items: DetailItem[] = [];
  const transcripts: DetailToolCard["transcripts"] = [];
  const transcriptIds = new Set<string>();
  for (const result of results) {
    const agent = textValue(result.agent) ?? "agent";
    const description =
      textValue(result.description) ?? textValue(result.assignment) ?? textValue(result.task);
    const exitCode = numberValue(result.exitCode);
    const durationMs = numberValue(result.durationMs);
    const tokens = numberValue(result.tokens);
    const output = rawText(result.output).trim();
    const stderr = rawText(result.stderr).trim();
    const label = description ?? agent;
    items.push(
      item(
        description ? `${agent} · ${description}` : agent,
        compactParts([
          textValue(result.resolvedModel) ?? textValue(result.modelOverride),
          exitCode != null ? `exit ${exitCode}` : null,
          durationMs != null ? formatDuration(durationMs) : null,
          tokens != null ? `${tokens} tokens` : null,
        ]),
        output || stderr || null,
        exitCode != null && exitCode !== 0 ? "error" : "ok",
      ),
    );
    const id = textValue(result.id);
    if (id) {
      transcripts.push({
        agentId: id,
        label,
        status: result.aborted === true ? "cancelled" : exitCode !== 0 ? "failed" : "completed",
        model: textValue(result.resolvedModel),
        durationMs: durationMs ?? 0,
      });
      transcriptIds.add(id);
    }
  }
  for (const row of progressRows) {
    const id = textValue(row.id);
    if (!id || transcriptIds.has(id)) continue;
    transcripts.push({
      agentId: id,
      label: textValue(row.description) ?? textValue(row.task) ?? (textValue(row.agent) ?? id),
      status: progressStatus(row.status),
      model: textValue(row.resolvedModel),
      durationMs: numberValue(row.durationMs) ?? 0,
    });
  }
  const totalDuration = numberValue(details.totalDurationMs);
  const tasks = arrayValue(data.tasks).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object",
  );
  const sections: Array<DetailSection | null> = [];
  if (items.length) sections.push({ kind: "items", label: "tasks", items });
  else if (tasks.length) {
    sections.push({
      kind: "items",
      label: "tasks",
      items: tasks.map((entry, index) =>
        item(
          textValue(entry.agent) ?? `Task ${index + 1}`,
          null,
          textValue(entry.description) ?? textValue(entry.prompt) ?? textValue(entry.task),
        ),
      ),
    });
    sections.push(textSection(parts.text));
  } else sections.push(textSection(parts.text));
  return buildCard("task", args, parts, opts, {
    target:
      firstLine(textValue(data.prompt) ?? textValue(data.task) ?? textValue(data.description)) ??
      firstLine(rawText(parts.text)),
    summary: null,
    chips: [
      ...(results.length
        ? [{ kind: "count" as const, unit: "agents" as const, value: results.length }]
        : []),
      ...(totalDuration != null
        ? [{ kind: "text" as const, text: formatDuration(totalDuration) }]
        : []),
    ],
    flags: opts.isError ? ["failed"] : [],
    sections,
    transcripts,
  });
}

export function askCard(
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const details = parts.details ?? {};
  const results = arrayValue(details.results).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object",
  );
  const items: DetailItem[] = [];
  let flatQuestion: string | null = null;
  const answers = arrayValue(details.answers).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object",
  );
  if (answers.length) {
    for (const entry of answers) {
      items.push(
        item(
          textValue(entry.question) ?? textValue(entry.name) ?? "Question",
          textValue(entry.answer) ?? undefined,
        ),
      );
    }
  } else if (results.length) {
    for (const result of results) {
      const selected = arrayValue(result.selectedOptions)
        .map((entry) => textValue(entry))
        .filter((entry): entry is string => entry != null);
      const custom = textValue(result.customInput);
      const answer = selected.join(", ") || custom;
      items.push(
        item(
          textValue(result.question) ?? "Question",
          answer,
          textValue(result.note),
          result.timedOut === true ? "muted" : "ok",
        ),
      );
    }
  } else {
    flatQuestion = textValue(details.question);
    if (flatQuestion) {
      const selected = arrayValue(details.selectedOptions)
        .map((entry) => textValue(entry))
        .filter((entry): entry is string => entry != null);
      items.push(
        item(
          flatQuestion,
          selected.join(", ") || textValue(details.customInput),
          textValue(details.note),
          details.timedOut === true ? "muted" : "ok",
        ),
      );
    } else {
      const questions = arrayValue(data.questions).filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object",
      );
      for (const entry of questions) {
        items.push(item(textValue(entry.question) ?? "Question"));
      }
    }
  }
  const redirectQuestions = arrayValue(details.questions)
    .map((entry) => textValue(entry))
    .filter((entry): entry is string => entry != null);
  const sections: Array<DetailSection | null> = [];
  if (items.length) sections.push({ kind: "items", label: "questions", items });
  if (details.chatRedirect === true && redirectQuestions.length) {
    sections.push({
      kind: "text",
      label: "questions",
      text: redirectQuestions.join("\n"),
    });
  }
  if (!sections.length) sections.push(textSection(parts.text));
  else if (!results.length && !flatQuestion && !answers.length) sections.push(textSection(parts.text));
  return buildCard("ask", args, parts, opts, {
    target: items[0]?.title ?? null,
    summary: firstLine(parts.text),
    chips: items.length ? [{ kind: "count", unit: "questions", value: items.length }] : [],
    flags:
      results.some((result) => result.timedOut === true) || details.timedOut === true
        ? ["timedOut"]
        : [],
    sections,
  });
}

const DEBUG_SNAPSHOT_FIELDS: Array<[string, string]> = [
  ["adapter", "Adapter"],
  ["status", "Status"],
  ["cwd", "CWD"],
  ["program", "Program"],
  ["stopReason", "Stop reason"],
  ["frameName", "Frame"],
  ["exitCode", "Exit code"],
];

export function debugCard(
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const details = parts.details ?? {};
  const snapshot = record(details.snapshot);
  const items: DetailItem[] = [];
  for (const [key, label] of DEBUG_SNAPSHOT_FIELDS) {
    const value = snapshot[key];
    if (value == null || value === "") continue;
    items.push(item(label, typeof value === "string" ? value : String(value)));
  }
  const source = record(snapshot.source);
  const sourcePath = textValue(source.path);
  const line = numberValue(snapshot.line);
  if (sourcePath) {
    items.push(item("Location", `${sourcePath}${line != null ? `:${line}` : ""}`));
  }
  const action = textValue(details.action) ?? textValue(data.action);
  const sections: Array<DetailSection | null> = [];
  if (items.length) sections.push({ kind: "items", label: "details", items });
  sections.push(textSection(parts.text));
  const file = textValue(data.file);
  const fileLine = numberValue(data.line);
  const fileTarget = file ? `${file}${fileLine != null ? `:${fileLine}` : ""}` : null;
  const target =
    textValue(data.program) ??
    fileTarget ??
    (sourcePath ? `${sourcePath}${line != null ? `:${line}` : ""}` : null) ??
    textValue(data.expression) ??
    textValue(data.command) ??
    textValue(data.name);
  return buildCard("debug", args, parts, opts, {
    target,
    summary: compactParts([action, textValue(snapshot.status)]),
    chips: action ? [{ kind: "text", text: action }] : [],
    flags:
      details.success === false || opts.isError
        ? ["failed"]
        : details.success === true
          ? ["ok"]
          : [],
    sections,
  });
}

/** AgentProgress.status 是 pending/running/completed/failed/aborted；aborted 归入 cancelled。 */
function progressStatus(
  value: unknown,
): "running" | "completed" | "failed" | "cancelled" | undefined {
  if (value === "running" || value === "completed" || value === "failed") return value;
  if (value === "aborted") return "cancelled";
  if (value === "pending") return "running";
  return undefined;
}

export function idaCard(
  args: unknown,
  parts: DetailResultParts,
  opts: DetailParseOptions,
): DetailToolCard {
  const data = record(args);
  const details = parts.details ?? {};
  const action = textValue(details.action) ?? textValue(data.action);
  const db = textValue(details.db) ?? textValue(data.db);
  const code = textValue(data.code);
  return buildCard("ida", args, parts, opts, {
    target: textValue(data.target) ?? textValue(data.name) ?? db,
    summary: compactParts([action, db]),
    chips: action ? [{ kind: "text", text: action }] : [],
    flags: opts.isError ? ["failed"] : [],
    sections: [codeSection(code, "python"), textSection(parts.text)],
  });
}

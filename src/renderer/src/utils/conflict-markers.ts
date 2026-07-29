/**
 * Parses Git conflict markers and applies/resolves choices.
 * Input is normalized: lines are split on CRLF or LF and rejoined as LF on output.
 */

export type ConflictChoice = "ours" | "theirs" | "unset";

export type ConflictSegment =
  | { kind: "text"; text: string }
  | { kind: "conflict"; id: number; ours: string; theirs: string };

export type ParseConflictResult =
  | { ok: true; segments: ConflictSegment[] }
  | { ok: false; reason: "no_markers" | "malformed" };

function blockFromLines(lines: string[]): string {
  if (lines.length === 0) return "";
  return `${lines.join("\n")}\n`;
}

export function parseConflictMarkers(content: string): ParseConflictResult {
  const lines = content.split(/\r?\n/);
  if (/\r?\n$/.test(content) && lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const segments: ConflictSegment[] = [];
  let conflictId = 0;
  let textLines: string[] = [];
  let i = 0;

  const flushText = (): void => {
    if (textLines.length === 0) return;
    segments.push({ kind: "text", text: blockFromLines(textLines) });
    textLines = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    if (/^<<<<<<</.test(line)) {
      flushText();
      i += 1;

      const oursLines: string[] = [];
      while (i < lines.length && !/^\|\|\|\|\|\|\|/.test(lines[i]) && !/^=======/.test(lines[i])) {
        oursLines.push(lines[i]);
        i += 1;
      }

      if (i < lines.length && /^\|\|\|\|\|\|\|/.test(lines[i])) {
        i += 1;
        while (i < lines.length && !/^=======/.test(lines[i])) {
          i += 1;
        }
      }

      if (i >= lines.length || !/^=======/.test(lines[i])) {
        return { ok: false, reason: "malformed" };
      }
      i += 1;

      const theirsLines: string[] = [];
      while (i < lines.length && !/^>>>>>>>/.test(lines[i])) {
        theirsLines.push(lines[i]);
        i += 1;
      }

      if (i >= lines.length || !/^>>>>>>>/.test(lines[i])) {
        return { ok: false, reason: "malformed" };
      }
      i += 1;

      segments.push({
        kind: "conflict",
        id: conflictId,
        ours: blockFromLines(oursLines),
        theirs: blockFromLines(theirsLines),
      });
      conflictId += 1;
      continue;
    }

    textLines.push(line);
    i += 1;
  }

  flushText();

  if (conflictId === 0) {
    return { ok: false, reason: "no_markers" };
  }

  return { ok: true, segments };
}

export function applyConflictChoices(
  segments: ConflictSegment[],
  choices: Record<number, ConflictChoice>,
): string | null {
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.kind === "text") {
      parts.push(seg.text);
      continue;
    }
    const choice = choices[seg.id];
    if (choice !== "ours" && choice !== "theirs") return null;
    parts.push(choice === "ours" ? seg.ours : seg.theirs);
  }
  return parts.join("");
}

export function previewConflictContent(
  segments: ConflictSegment[],
  choices: Record<number, ConflictChoice>,
): string {
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.kind === "text") {
      parts.push(seg.text);
      continue;
    }
    const choice = choices[seg.id] ?? "unset";
    if (choice === "ours") parts.push(seg.ours);
    else if (choice === "theirs") parts.push(seg.theirs);
    else {
      parts.push(`<<<<<<<\n${seg.ours}=======\n${seg.theirs}>>>>>>>\n`);
    }
  }
  return parts.join("");
}

export function conflictIds(segments: ConflictSegment[]): number[] {
  return segments.filter((s) => s.kind === "conflict").map((s) => s.id);
}

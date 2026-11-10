import {
  closeSync,
  fstatSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseSessionHistoryPageFromJsonl,
  parseSessionHistoryPageReverse,
} from "../../src/main/session-history-parse";
import { readBackwardLines } from "../../src/main/session-history-backward";

function jsonl(lines: unknown[]): string {
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

function historyLines(rounds: number, bigToolText = ""): unknown[] {
  const lines: unknown[] = [
    {
      type: "session",
      version: 3,
      id: "session-r",
      timestamp: "2026-01-15T12:00:00.000Z",
      cwd: "/tmp",
    },
  ];
  for (let i = 1; i <= rounds; i++) {
    lines.push({
      type: "message",
      id: `u${i}`,
      parentId: i === 1 ? null : `t${i - 1}`,
      timestamp: `2026-01-15T12:00:${String(i % 60).padStart(2, "0")}.000Z`,
      message: { role: "user", content: `user-${i}` },
    });
    lines.push({
      type: "message",
      id: `a${i}`,
      parentId: `u${i}`,
      timestamp: `2026-01-15T12:00:${String(i % 60).padStart(2, "0")}.100Z`,
      message: {
        role: "assistant",
        content: [
          { type: "text", text: `assistant-${i}` },
          { type: "thinking", thinking: `thinking-${i}` },
          { type: "toolCall", id: `call-${i}`, name: "read", arguments: { path: "a" } },
        ],
      },
    });
    lines.push({
      type: "message",
      id: `t${i}`,
      parentId: `a${i}`,
      timestamp: `2026-01-15T12:00:${String(i % 60).padStart(2, "0")}.200Z`,
      message: {
        role: "toolResult",
        toolCallId: `call-${i}`,
        toolName: "read",
        content: [{ type: "text", text: i === rounds ? bigToolText : `tool-${i}` }],
      },
    });
  }
  return lines;
}

function reversePage(filePath: string, limit: number, beforeId?: string) {
  const fd = openSync(filePath, "r");
  try {
    return parseSessionHistoryPageReverse({
      size: fstatSync(fd).size,
      readBackward: (from) => readBackwardLines(fd, from),
      limit,
      beforeId: beforeId ?? null,
    });
  } finally {
    closeSync(fd);
  }
}

const dir = mkdtempSync(join(tmpdir(), "pi-history-reverse-"));

describe("parseSessionHistoryPageReverse", () => {
  it("returns the same tail page as the full parse", () => {
    const raw = jsonl(historyLines(6));
    const filePath = join(dir, "small.jsonl");
    writeFileSync(filePath, raw, "utf8");

    const full = parseSessionHistoryPageFromJsonl(raw, { limit: 5 });
    const page = reversePage(filePath, 5);

    expect(page.messages).toEqual(full.messages);
    expect(page.hasMore).toBe(full.hasMore);
  });

  it("matches the full parse across multiple backward chunks", () => {
    const raw = jsonl(historyLines(10, "x".repeat(300_000)));
    const filePath = join(dir, "large.jsonl");
    writeFileSync(filePath, raw, "utf8");

    const full = parseSessionHistoryPageFromJsonl(raw, { limit: 12 });
    const page = reversePage(filePath, 12);

    expect(page.messages).toEqual(full.messages);
    expect(page.hasMore).toBe(full.hasMore);
  });

  it("pages older messages with beforeId", () => {
    const raw = jsonl(historyLines(8));
    const filePath = join(dir, "before.jsonl");
    writeFileSync(filePath, raw, "utf8");

    const tail = parseSessionHistoryPageFromJsonl(raw, { limit: 4 });
    const beforeId = tail.messages[0]!.id;
    const olderFull = parseSessionHistoryPageFromJsonl(raw, { limit: 4, beforeId });
    const older = reversePage(filePath, 4, beforeId);

    expect(older.messages).toEqual(olderFull.messages);
    expect(older.hasMore).toBe(olderFull.hasMore);
  });

  it("keeps reading when the tail window starts at beforeId", () => {
    type Line = {
      type: string;
      id: string;
      parentId?: string;
      timestamp: string;
      message?: Record<string, unknown>;
    };
    const entries: Line[] = [];
    let parentId: string | undefined;
    const push = (line: Omit<Line, "parentId">): void => {
      entries.push(parentId ? { ...line, parentId } : line);
      parentId = line.id;
    };
    let tick = 0;
    const stamp = (): string =>
      `2026-01-15T12:00:${String(tick++ % 60).padStart(2, "0")}.000Z`;
    for (let i = 1; i <= 30; i++) {
      for (let j = 0; j < 80; j++) {
        push({ type: "custom", id: `c${i}-${j}`, timestamp: stamp() });
      }
      push({
        type: "message",
        id: `u${i}`,
        timestamp: stamp(),
        message: { role: "user", content: `user-${i}` },
      });
      push({
        type: "message",
        id: `a${i}`,
        timestamp: stamp(),
        message: { role: "assistant", content: [{ type: "text", text: `assistant-${i}` }] },
      });
      push({
        type: "message",
        id: `t${i}`,
        timestamp: stamp(),
        message: { role: "toolResult", toolCallId: `call-${i}`, toolName: "read", content: [{ type: "text", text: `tool-${i}` }] },
      });
    }
    const before = entries.findIndex((entry) => entry.id === "u30");
    const chunks = [
      entries.slice(before),
      entries.slice(before - 80, before),
      entries.slice(0, before - 80),
    ];
    const starts = [90_000, 50_000, 0];
    let call = 0;
    const page = parseSessionHistoryPageReverse({
      size: 100_000,
      readBackward: () => {
        const chunk = chunks[call];
        if (!chunk) return null;
        return { start: starts[call++]!, lines: chunk.map((entry) => JSON.stringify(entry)) };
      },
      limit: 30,
      beforeId: "u30",
    });

    expect(page.messages).toHaveLength(30);
    expect(page.messages[0]?.id).toBe("u20");
    expect(page.messages.at(-1)?.id).toBe("t29");
    expect(page.hasMore).toBe(true);
  });

  it("keeps the last line readable without a trailing newline", () => {
    const raw = jsonl(historyLines(4)).trimEnd();
    const filePath = join(dir, "no-newline.jsonl");
    writeFileSync(filePath, raw, "utf8");

    const full = parseSessionHistoryPageFromJsonl(raw, { limit: 3 });
    const page = reversePage(filePath, 3);

    expect(page.messages).toEqual(full.messages);
  });

  it("cleans up", () => {
    rmSync(dir, { recursive: true, force: true });
    expect(true).toBe(true);
  });
});

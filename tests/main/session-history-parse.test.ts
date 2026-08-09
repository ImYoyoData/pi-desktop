import { describe, expect, it } from "vitest";
import {
  parseSessionHistoryJsonl,
  parseSessionHistoryPageFromJsonl,
} from "../../src/main/session-history-parse";

function jsonl(lines: unknown[]): string {
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

describe("parseSessionHistoryPageFromJsonl", () => {
  it("returns the same tail page as slicing a full parse", () => {
    const lines: unknown[] = [
      {
        type: "session",
        version: 3,
        id: "session-p",
        timestamp: "2026-01-15T12:00:00.000Z",
        cwd: "/tmp",
      },
    ];
    for (let i = 1; i <= 8; i++) {
      lines.push({
        type: "message",
        id: `u${i}`,
        parentId: i === 1 ? null : `a${i - 1}`,
        timestamp: `2026-01-15T12:00:${String(i).padStart(2, "0")}.000Z`,
        message: { role: "user", content: `user-${i}` },
      });
      lines.push({
        type: "message",
        id: `a${i}`,
        parentId: `u${i}`,
        timestamp: `2026-01-15T12:00:${String(i).padStart(2, "0")}.500Z`,
        message: {
          role: "assistant",
          content: [{ type: "text", text: `assistant-${i}` }],
        },
      });
    }
    const raw = jsonl(lines);
    const all = parseSessionHistoryJsonl(raw);
    const page = parseSessionHistoryPageFromJsonl(raw, { limit: 5 });

    expect(page.total).toBe(all.length);
    expect(page.hasMore).toBe(true);
    expect(page.messages).toEqual(all.slice(all.length - 5));
  });

  it("pages older messages with beforeId without returning the tail", () => {
    const lines: unknown[] = [
      {
        type: "session",
        version: 3,
        id: "session-p",
        timestamp: "2026-01-15T12:00:00.000Z",
        cwd: "/tmp",
      },
    ];
    for (let i = 1; i <= 6; i++) {
      lines.push({
        type: "message",
        id: `u${i}`,
        parentId: i === 1 ? null : `a${i - 1}`,
        timestamp: `2026-01-15T12:00:${String(i).padStart(2, "0")}.000Z`,
        message: { role: "user", content: `user-${i}` },
      });
      lines.push({
        type: "message",
        id: `a${i}`,
        parentId: `u${i}`,
        timestamp: `2026-01-15T12:00:${String(i).padStart(2, "0")}.500Z`,
        message: {
          role: "assistant",
          content: [{ type: "text", text: `assistant-${i}` }],
        },
      });
    }
    const raw = jsonl(lines);
    const page = parseSessionHistoryPageFromJsonl(raw, {
      limit: 4,
      beforeId: "u5",
    });
    expect(page.messages.map((m) => m.id)).toEqual(["u3", "a3", "u4", "a4"]);
    expect(page.hasMore).toBe(true);
    expect(page.messages.some((m) => m.id === "a6")).toBe(false);
  });

  it("only materializes images for the requested page under the global budget", () => {
    // Two user messages with images. Full parse prefers the newer image when
    // budget is tiny; an older page must not receive the newer image payload.
    const big = "x".repeat(200);
    const small = "hi";
    const raw = jsonl([
      {
        type: "session",
        version: 3,
        id: "session-img",
        timestamp: "2026-01-15T12:00:00.000Z",
        cwd: "/tmp",
      },
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "2026-01-15T12:00:01.000Z",
        message: {
          role: "user",
          content: [
            { type: "text", text: "old" },
            { type: "image", data: small, mimeType: "image/png" },
          ],
        },
      },
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: "2026-01-15T12:00:02.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
        },
      },
      {
        type: "message",
        id: "u2",
        parentId: "a1",
        timestamp: "2026-01-15T12:00:03.000Z",
        message: {
          role: "user",
          content: [
            { type: "text", text: "new" },
            { type: "image", data: big, mimeType: "image/png" },
          ],
        },
      },
    ]);

    // data:image/png;base64, + 200 ≈ 222 bytes; budget fits newer only.
    const budget = 230;
    const older = parseSessionHistoryPageFromJsonl(raw, {
      limit: 2,
      beforeId: "u2",
      imageBudgetBytes: budget,
    });
    expect(older.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
    const oldUser = older.messages[0]!;
    expect(oldUser.role).toBe("user");
    if (oldUser.role !== "user") return;
    // Newer image ate the budget → older page user has no images.
    expect(oldUser.images).toBeUndefined();

    const tail = parseSessionHistoryPageFromJsonl(raw, {
      limit: 2,
      imageBudgetBytes: budget,
    });
    const newUser = tail.messages.find((m) => m.id === "u2");
    expect(newUser?.role).toBe("user");
    if (newUser?.role !== "user") return;
    expect(newUser.images?.length).toBe(1);
    // Tail page must not carry the older image payload either.
    expect(tail.messages.some((m) => m.id === "u1")).toBe(false);
  });
});

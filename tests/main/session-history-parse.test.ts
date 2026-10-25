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

describe("parseSessionHistoryJsonl 断链与摘要还原", () => {
  const header = {
    type: "session",
    version: 3,
    id: "session-x",
    timestamp: "2026-01-15T12:00:00.000Z",
    cwd: "/tmp",
  };

  it("为 stop 打断的工具调用补一张已取消卡片", () => {
    const raw = jsonl([
      header,
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "2026-01-15T12:00:01.000Z",
        message: { role: "user", content: "跑一下" },
      },
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: "2026-01-15T12:00:02.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "准备执行" },
            { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "ls" } },
          ],
        },
      },
      // 没有 tool_result：stop 落在工具执行中
      {
        type: "message",
        id: "u2",
        parentId: "a1",
        timestamp: "2026-01-15T12:00:05.000Z",
        message: { role: "user", content: "换个问题" },
      },
    ]);

    const msgs = parseSessionHistoryJsonl(raw);
    const cancelled = msgs.find((m) => m.role === "tool");
    expect(cancelled).toBeDefined();
    if (!cancelled || cancelled.role !== "tool") return;
    expect(cancelled.toolCallId).toBe("call-1");
    expect(cancelled.toolName).toBe("bash");
    expect(cancelled.isError).toBe(true);
    // 位置在 assistant 之后、下一轮 user 之前
    expect(msgs.map((m) => m.id)).toEqual(["u1", "a1", "a1~call-1", "u2"]);
    // args 仍然保留
    expect(cancelled.args).toEqual({ command: "ls" });
  });

  it("已有 tool_result 时不重复补卡片", () => {
    const raw = jsonl([
      header,
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "2026-01-15T12:00:01.000Z",
        message: { role: "user", content: "跑一下" },
      },
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: "2026-01-15T12:00:02.000Z",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: {} }],
        },
      },
      {
        type: "message",
        id: "r1",
        parentId: "a1",
        timestamp: "2026-01-15T12:00:03.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "bash",
          content: [{ type: "text", text: "ok" }],
          isError: false,
        },
      },
    ]);
    const msgs = parseSessionHistoryJsonl(raw);
    expect(msgs.filter((m) => m.role === "tool").length).toBe(1);
    expect(msgs.map((m) => m.id)).toEqual(["u1", "r1"]);
  });

  it("恢复 compaction 与 branch_summary 摘要", () => {
    const raw = jsonl([
      header,
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "2026-01-15T12:00:01.000Z",
        message: { role: "user", content: "长对话" },
      },
      {
        type: "compaction",
        id: "c1",
        parentId: "u1",
        timestamp: "2026-01-15T12:00:10.000Z",
        summary: "压缩摘要正文",
        firstKeptEntryId: "u1",
        tokensBefore: 123456,
      },
      {
        type: "branch_summary",
        id: "b1",
        parentId: "c1",
        timestamp: "2026-01-15T12:00:20.000Z",
        fromId: "u1",
        summary: "分支摘要正文",
      },
    ]);
    const msgs = parseSessionHistoryJsonl(raw);
    expect(msgs.map((m) => m.id)).toEqual(["u1", "c1", "b1"]);
    const compaction = msgs[1];
    expect(compaction.role).toBe("summary");
    if (compaction.role !== "summary") return;
    expect(compaction.kind).toBe("compaction");
    expect(compaction.text).toBe("压缩摘要正文");
    expect(compaction.tokensBefore).toBe(123456);
    const branch = msgs[2];
    expect(branch.role).toBe("summary");
    if (branch.role !== "summary") return;
    expect(branch.kind).toBe("branch");
    expect(branch.text).toBe("分支摘要正文");
  });

  it("空摘要不产生气泡", () => {
    const raw = jsonl([
      header,
      {
        type: "compaction",
        id: "c1",
        parentId: null,
        timestamp: "2026-01-15T12:00:10.000Z",
        summary: "   ",
        tokensBefore: 1,
      },
    ]);
    expect(parseSessionHistoryJsonl(raw)).toEqual([]);
  });
});

describe("assistant thinking duration", () => {
  it("keeps the pi-recorded message duration for history thinking rows", () => {
    const raw = jsonl([
      {
        type: "session",
        version: 3,
        id: "session-t",
        timestamp: "2026-01-15T12:00:00.000Z",
        cwd: "/tmp",
      },
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "2026-01-15T12:00:00.000Z",
        message: { role: "user", content: "hi" },
      },
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: "2026-01-15T12:00:05.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "thinking text" },
            { type: "text", text: "answer" },
          ],
          durationMs: 4_200,
        },
      },
    ]);
    const messages = parseSessionHistoryJsonl(raw);
    const assistant = messages.find((m) => m.id === "a1");
    expect(assistant).toMatchObject({ thinking: "thinking text", thinkingDurationMs: 4_200 });
  });
});

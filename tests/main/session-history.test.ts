import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearSessionConversation, readSessionHistoryMessages, readSessionHistoryPage } from "../../src/main/session-history";

function writeJsonl(filePath: string, lines: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
}

describe("session-history", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desktop-history-"));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("returns user and assistant messages on the current leaf path", async () => {
    const filePath = path.join(tempRoot, "session.jsonl");
    writeJsonl(filePath, [
      {
        type: "session",
        version: 3,
        id: "session-a",
        timestamp: "2026-01-15T12:00:00.000Z",
        cwd: tempRoot,
      },
      {
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-01-15T12:00:01.000Z",
        message: { role: "user", content: "Hello" },
      },
      {
        type: "message",
        id: "m2",
        parentId: "m1",
        timestamp: "2026-01-15T12:00:02.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hi there" }],
        },
      },
    ]);

    const messages = await readSessionHistoryMessages(filePath);

    expect(messages).toEqual([
      { id: "m1", role: "user", text: "Hello" },
      { id: "m2", role: "assistant", text: "Hi there" },
    ]);
  });

  it("includes toolResult entries as tool history messages", async () => {
    const filePath = path.join(tempRoot, "session-tools.jsonl");
    writeJsonl(filePath, [
      {
        type: "session",
        version: 3,
        id: "session-b",
        timestamp: "2026-01-15T12:00:00.000Z",
        cwd: tempRoot,
      },
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "2026-01-15T12:00:01.000Z",
        message: { role: "user", content: "read file" },
      },
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: "2026-01-15T12:00:02.000Z",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "tc1", name: "read", arguments: { path: "a.ts" } }],
        },
      },
      {
        type: "message",
        id: "t1",
        parentId: "a1",
        timestamp: "2026-01-15T12:00:03.000Z",
        message: {
          role: "toolResult",
          toolCallId: "tc1",
          toolName: "read",
          content: [{ type: "text", text: "file contents" }],
          isError: false,
        },
      },
    ]);

    const messages = await readSessionHistoryMessages(filePath);
    expect(messages).toEqual([
      { id: "u1", role: "user", text: "read file" },
      {
        id: "t1",
        role: "tool",
        toolCallId: "tc1",
        toolName: "read",
        text: "file contents",
        isError: false,
        args: { path: "a.ts" },
      },
    ]);
  });

  it("attaches write toolCall arguments so UI can synthesize an add diff", async () => {
    const filePath = path.join(tempRoot, "session-write.jsonl");
    writeJsonl(filePath, [
      {
        type: "session",
        version: 3,
        id: "session-w",
        timestamp: "2026-01-15T12:00:00.000Z",
        cwd: tempRoot,
      },
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "2026-01-15T12:00:01.000Z",
        message: { role: "user", content: "create file" },
      },
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: "2026-01-15T12:00:02.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "tc-w",
              name: "write",
              arguments: { path: "hello.ts", content: "const x = 1;\nexport { x };" },
            },
          ],
        },
      },
      {
        type: "message",
        id: "t1",
        parentId: "a1",
        timestamp: "2026-01-15T12:00:03.000Z",
        message: {
          role: "toolResult",
          toolCallId: "tc-w",
          toolName: "write",
          content: [{ type: "text", text: "Wrote hello.ts" }],
          isError: false,
        },
      },
    ]);

    const messages = await readSessionHistoryMessages(filePath);
    const tool = messages.find((m) => m.role === "tool");
    expect(tool).toMatchObject({
      role: "tool",
      toolName: "write",
      args: { path: "hello.ts", content: "const x = 1;\nexport { x };" },
    });
  });

  it("returns empty array for missing files", async () => {
    const messages = await readSessionHistoryMessages(path.join(tempRoot, "missing.jsonl"));
    expect(messages).toEqual([]);
  });

  it("clearSessionConversation drops messages but keeps header and session_info", async () => {
    const filePath = path.join(tempRoot, "session-clear.jsonl");
    writeJsonl(filePath, [
      {
        type: "session",
        version: 3,
        id: "session-c",
        timestamp: "2026-01-15T12:00:00.000Z",
        cwd: tempRoot,
      },
      {
        type: "session_info",
        id: "info1",
        parentId: null,
        timestamp: "2026-01-15T12:00:00.500Z",
        name: "Keep me",
      },
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "2026-01-15T12:00:01.000Z",
        message: { role: "user", content: "hello" },
      },
      {
        type: "compaction",
        id: "c1",
        parentId: "u1",
        timestamp: "2026-01-15T12:00:02.000Z",
        summary: "summary",
        firstKeptEntryId: "u1",
        tokensBefore: 1,
      },
    ]);

    await clearSessionConversation(filePath);
    expect(await readSessionHistoryMessages(filePath)).toEqual([]);

    const raw = fs.readFileSync(filePath, "utf8");
    expect(raw).toContain('"type":"session"');
    expect(raw).toContain('"type":"session_info"');
    expect(raw).not.toContain('"type":"message"');
    expect(raw).not.toContain('"type":"compaction"');
  });

  it("pages history: tail first, then older beforeId", async () => {
    const filePath = path.join(tempRoot, "session-page.jsonl");
    const lines: unknown[] = [
      {
        type: "session",
        version: 3,
        id: "session-p",
        timestamp: "2026-01-15T12:00:00.000Z",
        cwd: tempRoot,
      },
    ];
    for (let i = 1; i <= 12; i++) {
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
    writeJsonl(filePath, lines);

    const tail = await readSessionHistoryPage(filePath, { limit: 5 });
    expect(tail.total).toBe(24);
    expect(tail.messages).toHaveLength(5);
    expect(tail.hasMore).toBe(true);
    expect(tail.messages.map((m) => m.id)).toEqual(["a10", "u11", "a11", "u12", "a12"]);

    const older = await readSessionHistoryPage(filePath, {
      limit: 5,
      beforeId: tail.messages[0]!.id,
    });
    expect(older.messages).toHaveLength(5);
    expect(older.hasMore).toBe(true);
    expect(older.messages.map((m) => m.id)).toEqual(["u8", "a8", "u9", "a9", "u10"]);

    const head = await readSessionHistoryPage(filePath, {
      limit: 50,
      beforeId: "u1",
    });
    expect(head.messages).toEqual([]);
    expect(head.hasMore).toBe(false);
  });

  it("restores images and attachment tags for user messages after reload", async () => {
    const filePath = path.join(tempRoot, "session.jsonl");
    const agentText = "[pi-desktop mode: agent]\n\nDo the work";
    // sidecar written by persistUserMessageMeta
    fs.writeFileSync(
      `${filePath}.ui-meta.json`,
      JSON.stringify({
        version: 1,
        entries: [
          {
            text: agentText,
            tags: [
              { kind: "file", url: "", host: "", label: "src/a.ts", content: "src/a.ts" },
            ],
          },
        ],
      }),
      "utf8",
    );
    writeJsonl(filePath, [
      {
        type: "session",
        version: 3,
        id: "session-a",
        timestamp: "2026-01-15T12:00:00.000Z",
        cwd: tempRoot,
      },
      {
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-01-15T12:00:01.000Z",
        message: {
          role: "user",
          content: [
            { type: "text", text: agentText },
            { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
          ],
        },
      },
    ]);

    const messages = await readSessionHistoryMessages(filePath);
    expect(messages).toHaveLength(1);
    const user = messages[0]!;
    expect(user.role).toBe("user");
    if (user.role !== "user") return;
    expect(user.text).toBe("Do the work"); // mode preamble stripped
    expect(user.images).toEqual([
      { mimeType: "image/png", dataUrl: "data:image/png;base64,aGVsbG8=" },
    ]);
    expect(user.elementTags).toEqual([
      { kind: "file", url: "", host: "", label: "src/a.ts", content: "src/a.ts" },
    ]);
  });

  it("strips the browser-selection citations block from displayed user text", async () => {
    const filePath = path.join(tempRoot, "session2.jsonl");
    const header = "# 内置浏览器 (Built-in browser)";
    writeJsonl(filePath, [
      {
        type: "session",
        version: 3,
        id: "session-b",
        timestamp: "2026-01-15T12:00:00.000Z",
        cwd: tempRoot,
      },
      {
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-01-15T12:00:01.000Z",
        message: {
          role: "user",
          content: [
            { type: "text", text: header + "\n\nContext from browser selection:\n\n### Citation 1\n- URL: x\n- Text: y\n\n---\n\n[pi-desktop mode: agent]\n\nRead this page" },
          ],
        },
      },
    ]);

    const messages = await readSessionHistoryMessages(filePath);
    const user = messages[0]!;
    if (user.role !== "user") return;
    expect(user.text).toBe("Read this page");
  });
});

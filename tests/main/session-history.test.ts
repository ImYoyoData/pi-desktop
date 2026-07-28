import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearSessionConversation, readSessionHistoryMessages } from "../../src/main/session-history";

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
});

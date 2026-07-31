import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../src/renderer/src/stores/chat-reducer";
import {
  dropErrorKeepHistory,
  findUserBeforeError,
  turnHasProgressBeforeError,
} from "../../src/renderer/src/utils/chat-retry-continue";

function user(id: string, text = "hi"): ChatMessage {
  return { id, role: "user", text };
}
function assistant(id: string, text = "partial"): ChatMessage {
  return { id, role: "assistant", text };
}
function tool(id: string): ChatMessage {
  return {
    id,
    role: "tool",
    toolName: "bash",
    toolCallId: id,
    args: {},
  };
}
function err(id: string): ChatMessage {
  return { id, role: "error", text: "timeout" };
}

describe("chat-retry-continue", () => {
  it("keeps user and AI replies when dropping the error", () => {
    const messages = [user("u1"), assistant("a1"), tool("t1"), err("e1")];
    expect(dropErrorKeepHistory(messages, "e1")?.map((m) => m.id)).toEqual([
      "u1",
      "a1",
      "t1",
    ]);
  });

  it("detects turn progress and finds the preceding user", () => {
    const withProgress = [user("u1"), assistant("a1"), err("e1")];
    expect(turnHasProgressBeforeError(withProgress, "e1")).toBe(true);
    expect(findUserBeforeError(withProgress, "e1")?.id).toBe("u1");

    const noProgress = [user("u1"), err("e1")];
    expect(turnHasProgressBeforeError(noProgress, "e1")).toBe(false);
  });
});

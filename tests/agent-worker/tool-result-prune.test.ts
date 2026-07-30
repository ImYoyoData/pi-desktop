import { describe, expect, it } from "vitest";
import {
  pruneOldToolResults,
  type AgentMessageLike,
} from "../../src/agent-worker/tool-result-prune";

function toolResult(id: string, text: string, toolName = "bash"): AgentMessageLike {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName,
    content: [{ type: "text", text }],
    isError: false,
  };
}

describe("pruneOldToolResults", () => {
  it("keeps recent tool outputs and truncates older large ones", () => {
    const recent = "r".repeat(400); // ~100 tokens — exhausts protect budget
    const old = "o".repeat(20_000); // ~5000 tokens
    const messages: AgentMessageLike[] = [
      { role: "user", content: "go" },
      toolResult("t1", old),
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
      toolResult("t2", recent),
    ];

    const result = pruneOldToolResults(messages, {
      protectTokens: 100,
      minimumReclaimTokens: 100,
      maxResultChars: 500,
    });

    expect(result.changed).toBe(true);
    expect(result.prunedCount).toBe(1);
    expect(result.tokensFreed).toBeGreaterThan(100);

    const prunedText = (messages[1]!.content as { text: string }[])[0]!.text;
    expect(prunedText.length).toBeLessThan(old.length);
    expect(prunedText).toContain("[output truncated by prune");
    // Recent result untouched
    expect((messages[3]!.content as { text: string }[])[0]!.text).toBe(recent);
  });

  it("skips when reclaimable tokens are below minimum", () => {
    const messages: AgentMessageLike[] = [
      toolResult("t1", "x".repeat(800)),
      toolResult("t2", "y".repeat(100)),
    ];
    const before = JSON.stringify(messages);
    const result = pruneOldToolResults(messages, {
      protectTokens: 50,
      minimumReclaimTokens: 50_000,
      maxResultChars: 100,
    });
    expect(result.changed).toBe(false);
    expect(JSON.stringify(messages)).toBe(before);
  });

  it("never truncates protected tool names", () => {
    const big = "z".repeat(12_000);
    const messages: AgentMessageLike[] = [
      toolResult("s1", big, "skill"),
      toolResult("a1", big, "ask_user"),
      toolResult("b1", "tiny"),
    ];
    const result = pruneOldToolResults(messages, {
      protectTokens: 0,
      minimumReclaimTokens: 100,
      maxResultChars: 200,
    });
    expect(result.prunedCount).toBe(0);
    expect((messages[0]!.content as { text: string }[])[0]!.text).toBe(big);
    expect((messages[1]!.content as { text: string }[])[0]!.text).toBe(big);
  });

  it("is idempotent on already-pruned results", () => {
    const old = "o".repeat(10_000);
    const recent = "n".repeat(400); // ~100 tokens
    const messages: AgentMessageLike[] = [toolResult("t1", old), toolResult("t2", recent)];
    const first = pruneOldToolResults(messages, {
      protectTokens: 100,
      minimumReclaimTokens: 50,
      maxResultChars: 300,
    });
    expect(first.changed).toBe(true);
    const snapshot = JSON.stringify(messages);
    const second = pruneOldToolResults(messages, {
      protectTokens: 100,
      minimumReclaimTokens: 50,
      maxResultChars: 300,
    });
    expect(second.changed).toBe(false);
    expect(JSON.stringify(messages)).toBe(snapshot);
  });
});

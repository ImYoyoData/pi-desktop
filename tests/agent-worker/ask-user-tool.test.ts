import { describe, expect, it, vi } from "vitest";
import { createAskUserToolDefinition } from "../../src/agent-worker/ask-user-tool";

describe("createAskUserToolDefinition", () => {
  it("waits for answers and returns them as tool content", async () => {
    const waitForAnswers = vi.fn(async () => "[ask_user answers]\n1. ok");
    const tool = createAskUserToolDefinition({ waitForAnswers });
    expect(tool.name).toBe("ask_user");
    const result = await tool.execute(
      "tc-1",
      {
        questions: [
          {
            id: "q1",
            prompt: "OK?",
            type: "buttons",
            options: [
              { id: "y", label: "Yes" },
              { id: "n", label: "No" },
            ],
          },
        ],
      },
      undefined,
      undefined,
      {} as never,
    );
    expect(waitForAnswers).toHaveBeenCalledOnce();
    const text = result.content.map((c) => ("text" in c ? c.text : "")).join("");
    expect(text).toContain("[ask_user answers]");
  });

  it("rejects empty questions without waiting", async () => {
    const waitForAnswers = vi.fn(async () => "nope");
    const tool = createAskUserToolDefinition({ waitForAnswers });
    await expect(
      tool.execute("tc-2", { questions: [] }, undefined, undefined, {} as never),
    ).rejects.toThrow(/question/i);
    expect(waitForAnswers).not.toHaveBeenCalled();
  });

  it("runs sequentially so no other tool can execute while waiting for answers", () => {
    const tool = createAskUserToolDefinition({});
    expect(tool.executionMode).toBe("sequential");
  });
});

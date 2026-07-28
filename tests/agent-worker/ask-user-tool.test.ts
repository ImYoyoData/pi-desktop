import { describe, expect, it } from "vitest";
import { createAskUserToolDefinition } from "../../src/agent-worker/ask-user-tool";

describe("createAskUserToolDefinition", () => {
  it("returns immediately with ack text", async () => {
    const tool = createAskUserToolDefinition();
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
    const text = result.content.map((c) => ("text" in c ? c.text : "")).join("");
    expect(text).toMatch(/Await their next message/i);
  });

  it("rejects empty questions", async () => {
    const tool = createAskUserToolDefinition();
    await expect(
      tool.execute("tc-2", { questions: [] }, undefined, undefined, {} as never),
    ).rejects.toThrow(/question/i);
  });
});

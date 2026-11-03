import { describe, expect, it, vi } from "vitest";
import { createAskUserToolDefinition } from "../../src/agent-worker/ask-user-tool";

const CONFIRM_OPTIONS = [
  { id: "y", label: "Yes" },
  { id: "n", label: "No" },
];

describe("createAskUserToolDefinition", () => {
  it("waits for answers and returns them as tool content", async () => {
    const waitForAnswers = vi.fn(async () => '{"answers":{"q1":{"answers":["Yes"]}}}');
    const tool = createAskUserToolDefinition({ waitForAnswers });
    expect(tool.name).toBe("ask_user");
    const result = await tool.execute(
      "tc-1",
      {
        questions: [
          {
            id: "q1",
            header: "确认",
            prompt: "OK?",
            type: "buttons",
            options: CONFIRM_OPTIONS,
          },
        ],
      },
      undefined,
      undefined,
      {} as never,
    );
    expect(waitForAnswers).toHaveBeenCalledOnce();
    expect(waitForAnswers).toHaveBeenCalledWith(
      expect.any(Array),
      undefined,
      "tc-1",
    );
    const text = result.content.map((c) => ("text" in c ? c.text : "")).join("");
    expect(text).toContain('"answers"');
  });

  it("passes attached images through as image content", async () => {
    const waitForAnswers = vi.fn(async () => ({
      text: '{"answers":{"q1":{"answers":["Yes"]}}}',
      images: [{ data: "AAAA", mimeType: "image/png" }],
    }));
    const tool = createAskUserToolDefinition({ waitForAnswers });
    const result = await tool.execute(
      "tc-img",
      {
        questions: [
          {
            id: "q1",
            header: "确认",
            prompt: "OK?",
            type: "buttons",
            options: CONFIRM_OPTIONS,
          },
        ],
      },
      undefined,
      undefined,
      {} as never,
    );
    expect(result.content).toContainEqual({
      type: "image",
      data: "AAAA",
      mimeType: "image/png",
    });
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

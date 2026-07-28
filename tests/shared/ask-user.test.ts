import { describe, expect, it } from "vitest";
import {
  formatAskUserAnswers,
  parseAskUserArgs,
  validateAskUserAnswers,
  type AskUserAnswerDraft,
} from "../../src/shared/ask-user";

describe("parseAskUserArgs", () => {
  it("parses a valid single-question payload", () => {
    const prompt = parseAskUserArgs({
      questions: [
        {
          id: "env",
          prompt: "Deploy where?",
          type: "single",
          options: [
            { id: "prod", label: "production" },
            { id: "other", label: "other", allowCustom: true },
          ],
        },
      ],
    });
    expect(prompt?.questions).toHaveLength(1);
    expect(prompt?.questions[0]?.type).toBe("single");
  });

  it("returns null for empty questions", () => {
    expect(parseAskUserArgs({ questions: [] })).toBeNull();
  });
});

describe("validateAskUserAnswers + formatAskUserAnswers", () => {
  const prompt = parseAskUserArgs({
    questions: [
      {
        id: "env",
        prompt: "Deploy where?",
        type: "single",
        options: [
          { id: "prod", label: "production" },
          { id: "other", label: "other", allowCustom: true },
        ],
      },
      {
        id: "flags",
        prompt: "Flags?",
        type: "multi",
        options: [
          { id: "a", label: "alpha" },
          { id: "b", label: "beta" },
          { id: "c", label: "custom", allowCustom: true },
        ],
      },
      {
        id: "go",
        prompt: "Proceed?",
        type: "buttons",
        options: [
          { id: "yes", label: "Confirm" },
          { id: "no", label: "Reject" },
        ],
      },
    ],
  })!;

  it("requires custom text when allowCustom option selected", () => {
    const draft: AskUserAnswerDraft = {
      env: { optionIds: ["other"], customText: "   " },
      flags: { optionIds: ["a"], customText: "" },
      go: { optionIds: ["yes"], customText: "" },
    };
    expect(validateAskUserAnswers(prompt, draft)).toMatch(/custom/i);
  });

  it("formats answers with prefix and ids", () => {
    const draft: AskUserAnswerDraft = {
      env: { optionIds: ["other"], customText: "canary 10%" },
      flags: { optionIds: ["a", "c"], customText: "extra" },
      go: { optionIds: ["no"], customText: "" },
    };
    expect(validateAskUserAnswers(prompt, draft)).toBeNull();
    const text = formatAskUserAnswers(prompt, draft);
    expect(text.startsWith("[ask_user answers]\n")).toBe(true);
    expect(text).toContain("(id=env)");
    expect(text).toContain("custom: canary 10%");
    expect(text).toContain("Reject");
  });
});

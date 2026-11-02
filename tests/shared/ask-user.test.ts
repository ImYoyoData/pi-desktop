import { describe, expect, it } from "vitest";
import {
  ASK_USER_CUSTOM_OPTION_ID,
  ASK_USER_HEADER_MAX,
  formatAskUserAnswers,
  parseAskUserArgs,
  splitRecommendedLabel,
  validateAskUserAnswers,
  withEnsuredCustomOption,
  type AskUserAnswerDraft,
} from "../../src/shared/ask-user";

const OPTIONS = [
  { id: "prod", label: "production" },
  { id: "stage", label: "staging" },
];

describe("parseAskUserArgs", () => {
  it("parses a valid single-question payload and injects the None of the above row", () => {
    const prompt = parseAskUserArgs({
      questions: [
        {
          id: "env",
          header: "目标",
          prompt: "Deploy where?",
          type: "single",
          options: OPTIONS,
        },
      ],
    });
    expect(prompt?.questions).toHaveLength(1);
    expect(prompt?.questions[0]?.type).toBe("single");
    expect(prompt?.questions[0]?.header).toBe("目标");
    const options = prompt?.questions[0]?.options ?? [];
    expect(options.some((o) => o.id === ASK_USER_CUSTOM_OPTION_ID)).toBe(true);
    expect(options.find((o) => o.id === ASK_USER_CUSTOM_OPTION_ID)?.label).toBe(
      "None of the above",
    );
  });

  it("always appends the free-form row, even when an option allows custom text", () => {
    const prompt = parseAskUserArgs({
      questions: [
        {
          id: "env",
          header: "环境",
          prompt: "Deploy where?",
          type: "single",
          options: [
            { id: "prod", label: "production" },
            { id: "other", label: "other", allowCustom: true },
          ],
        },
      ],
    });
    const options = prompt?.questions[0]?.options ?? [];
    expect(options.filter((o) => o.id === ASK_USER_CUSTOM_OPTION_ID)).toHaveLength(1);
    expect(options.map((o) => o.id)).toContain("other");
  });

  it("returns null for empty questions", () => {
    expect(parseAskUserArgs({ questions: [] })).toBeNull();
  });

  it("rejects a question with fewer than two options", () => {
    const prompt = parseAskUserArgs({
      questions: [
        {
          id: "env",
          prompt: "Deploy where?",
          type: "single",
          options: [{ id: "prod", label: "production" }],
        },
      ],
    });
    expect(prompt).toBeNull();
  });

  it("rejects the whole payload when any question is invalid", () => {
    const prompt = parseAskUserArgs({
      questions: [
        {
          id: "env",
          prompt: "Deploy where?",
          type: "single",
          options: [{ id: "prod", label: "production" }],
        },
        { id: "flags", prompt: "Flags?", type: "multi", options: OPTIONS },
      ],
    });
    expect(prompt).toBeNull();
  });

  it("rejects a question with more than three options", () => {
    const prompt = parseAskUserArgs({
      questions: [
        {
          id: "env",
          prompt: "Deploy where?",
          type: "single",
          options: [
            { id: "a", label: "a" },
            { id: "b", label: "b" },
            { id: "c", label: "c" },
            { id: "d", label: "d" },
          ],
        },
      ],
    });
    expect(prompt).toBeNull();
  });

  it("stays valid when reparsed after the free-form row was appended", () => {
    const args = {
      questions: [
        {
          id: "env",
          prompt: "Deploy where?",
          type: "single",
          options: [...OPTIONS, { id: "dev", label: "dev" }],
        },
      ],
    };
    const first = parseAskUserArgs(args);
    expect(first?.questions[0]?.options).toHaveLength(4);
    expect(parseAskUserArgs({ questions: first?.questions })?.questions).toHaveLength(1);
  });

  it("rejects more than three questions", () => {
    const prompt = parseAskUserArgs({
      questions: Array.from({ length: 4 }, (_, i) => ({
        id: `q${i}`,
        prompt: `Question ${i}?`,
        type: "single",
        options: OPTIONS,
      })),
    });
    expect(prompt).toBeNull();
  });

  it("rejects duplicate question ids", () => {
    const prompt = parseAskUserArgs({
      questions: [
        { id: "env", prompt: "First?", type: "single", options: OPTIONS },
        { id: "env", prompt: "Second?", type: "single", options: OPTIONS },
      ],
    });
    expect(prompt).toBeNull();
  });

  it("truncates the header and falls back to the legacy title field", () => {
    const prompt = parseAskUserArgs({
      questions: [
        {
          id: "scope",
          header: "改动范围与文档同步",
          prompt: "只改代码还是也改文档?",
          type: "single",
          options: OPTIONS,
        },
        {
          id: "legacy",
          title: "旧标题",
          prompt: "Legacy?",
          type: "single",
          options: OPTIONS,
        },
      ],
    });
    expect(prompt?.questions[0]?.header).toBe(
      "改动范围与文档同步".slice(0, ASK_USER_HEADER_MAX),
    );
    expect(prompt?.questions[1]?.header).toBe("旧标题");
  });

  it("keeps isSecret and skippable flags", () => {
    const prompt = parseAskUserArgs({
      questions: [
        {
          id: "token",
          header: "令牌",
          prompt: "API token?",
          type: "single",
          isSecret: true,
          skippable: false,
          options: OPTIONS,
        },
      ],
    });
    expect(prompt?.questions[0]?.isSecret).toBe(true);
    expect(prompt?.questions[0]?.skippable).toBe(false);
  });
});

describe("splitRecommendedLabel", () => {
  it("strips the recommended suffix", () => {
    expect(splitRecommendedLabel("Deploy now (Recommended)")).toEqual({
      text: "Deploy now",
      recommended: true,
    });
    expect(splitRecommendedLabel("先部署 (推荐)")).toEqual({
      text: "先部署",
      recommended: true,
    });
  });

  it("leaves plain labels alone", () => {
    expect(splitRecommendedLabel("Plain")).toEqual({
      text: "Plain",
      recommended: false,
    });
  });
});

describe("withEnsuredCustomOption", () => {
  it("adds the free-form row to buttons too", () => {
    const q = withEnsuredCustomOption({
      id: "go",
      prompt: "Proceed?",
      type: "buttons",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
    });
    expect(q.options).toHaveLength(3);
    expect(q.options[2]?.id).toBe(ASK_USER_CUSTOM_OPTION_ID);
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

  it("requires text for the injected free-form row", () => {
    const withCustomRow = parseAskUserArgs({
      questions: [
        {
          id: "env",
          prompt: "Deploy where?",
          type: "single",
          options: OPTIONS,
        },
      ],
    })!;
    expect(
      validateAskUserAnswers(withCustomRow, {
        env: { optionIds: [ASK_USER_CUSTOM_OPTION_ID], customText: "   ", skipped: false },
      }),
    ).toBe("custom-required");
    expect(
      validateAskUserAnswers(withCustomRow, {
        env: { optionIds: [ASK_USER_CUSTOM_OPTION_ID], customText: "staging", skipped: false },
      }),
    ).toBeNull();
  });

  it("treats a model-authored allowCustom option as optional detail", () => {
    const draft: AskUserAnswerDraft = {
      env: { optionIds: ["other"], customText: "   ", skipped: false },
      flags: { optionIds: ["a"], customText: "", skipped: false },
      go: { optionIds: ["yes"], customText: "", skipped: false },
    };
    expect(validateAskUserAnswers(prompt, draft)).toBeNull();
    expect(JSON.parse(formatAskUserAnswers(prompt, draft))).toEqual({
      answers: {
        env: { answers: ["other"] },
        flags: { answers: ["alpha"] },
        go: { answers: ["Confirm"] },
      },
    });
  });

  it("allows skipped questions and formats them as an empty answers array", () => {
    const draft: AskUserAnswerDraft = {
      env: { optionIds: [], customText: "", skipped: true },
      flags: { optionIds: ["a"], customText: "", skipped: false },
      go: { optionIds: ["yes"], customText: "", skipped: false },
    };
    expect(validateAskUserAnswers(prompt, draft)).toBeNull();
    expect(JSON.parse(formatAskUserAnswers(prompt, draft)).answers.env).toEqual({
      answers: [],
    });
  });

  it("rejects skipping a question marked skippable:false", () => {
    const required = parseAskUserArgs({
      questions: [
        {
          id: "go",
          prompt: "Proceed?",
          type: "buttons",
          skippable: false,
          options: [
            { id: "yes", label: "Confirm" },
            { id: "no", label: "Reject" },
          ],
        },
      ],
    })!;
    const draft: AskUserAnswerDraft = {
      go: { optionIds: [], customText: "", skipped: true },
    };
    expect(validateAskUserAnswers(required, draft)).toBe("cannot-skip");
    expect(
      validateAskUserAnswers(required, {
        ...draft,
        go: { optionIds: ["yes"], customText: "", skipped: false },
      }),
    ).toBeNull();
  });

  it("appends free text next to the selected labels", () => {
    const draft: AskUserAnswerDraft = {
      env: { optionIds: ["other"], customText: "canary 10%", skipped: false },
      flags: { optionIds: ["a", "c"], customText: "extra", skipped: false },
      go: { optionIds: ["no"], customText: "", skipped: false },
    };
    expect(validateAskUserAnswers(prompt, draft)).toBeNull();
    expect(JSON.parse(formatAskUserAnswers(prompt, draft))).toEqual({
      answers: {
        env: { answers: ["other", "canary 10%"] },
        flags: { answers: ["alpha", "custom", "extra"] },
        go: { answers: ["Reject"] },
      },
    });
  });

  it("accepts a free-text answer without picking an option", () => {
    const draft: AskUserAnswerDraft = {
      env: { optionIds: [], customText: "staging", skipped: false },
      flags: { optionIds: [], customText: "only alpha", skipped: false },
      go: { optionIds: [], customText: "ship it", skipped: false },
    };
    expect(validateAskUserAnswers(prompt, draft)).toBeNull();
    const parsed = JSON.parse(formatAskUserAnswers(prompt, draft));
    expect(parsed.answers.env).toEqual({ answers: ["staging"] });
    expect(parsed.answers.go).toEqual({ answers: ["ship it"] });
  });
});

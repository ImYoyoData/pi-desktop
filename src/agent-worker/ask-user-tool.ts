import { Type, type Static } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  ASK_USER_TIMEOUT_MS,
  ASK_USER_TOOL_NAME,
  parseAskUserArgs,
  type AskUserQuestion,
} from "../shared/ask-user";
import { rpcToMain } from "./main-rpc";

const askUserSchema = Type.Object({
  questions: Type.Array(
    Type.Object({
      id: Type.String({ description: "Stable question id" }),
      prompt: Type.String({ description: "Question shown to the user" }),
      type: Type.Union([
        Type.Literal("single"),
        Type.Literal("multi"),
        Type.Literal("buttons"),
      ]),
      options: Type.Array(
        Type.Object({
          id: Type.String(),
          label: Type.String(),
          allowCustom: Type.Optional(
            Type.Boolean({
            description:
              "If true, selecting this option shows a free-text field. Works for any type (single/multi/buttons). Desktop always adds a custom option for single/multi when missing.",
            }),
          ),
        }),
        { minItems: 1 },
      ),
    }),
    { minItems: 1 },
  ),
});

export type AskUserToolInput = Static<typeof askUserSchema>;

export type AskUserWaitForAnswers = (
  questions: AskUserQuestion[],
) => Promise<string>;

async function defaultWaitForAnswers(questions: AskUserQuestion[]): Promise<string> {
  const raw = await rpcToMain(
    "desktop.askUser",
    { questions },
    ASK_USER_TIMEOUT_MS,
  );
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("ask_user: no answers from user");
  }
  return raw.trim();
}

export function createAskUserToolDefinition(deps?: {
  waitForAnswers?: AskUserWaitForAnswers;
}) {
  const waitForAnswers = deps?.waitForAnswers ?? defaultWaitForAnswers;
  return defineTool({
    name: ASK_USER_TOOL_NAME,
    label: "Ask user",
    description:
      "Show an interactive question wizard in Pi Desktop (single-select, multi-select, or buttons). Blocks until the user answers every question. Prefer one call with multiple questions over many sequential calls.",
    promptSnippet:
      "Ask the user structured single/multi/button questions and wait for all answers",
    promptGuidelines: [
      "Use ask_user instead of only asking clarifying choices in prose when a discrete choice is needed.",
      "Put multiple related questions in one ask_user call; the UI collects all answers before continuing.",
      "Desktop always offers a custom free-text option for single/multi; you may also set allowCustom on any option of any type (single/multi/buttons). In plan/task confirm dialogs, mark the adjust/revise option allowCustom so the user can type adjustment instructions.",
      "Option labels are plain text — no emoji, icons, or decorative symbols.",
      "Do not invent answers — ask_user blocks until the user submits.",
    ],
    executionMode: "sequential",
    parameters: askUserSchema,
    async execute(_toolCallId, params) {
      const parsed = parseAskUserArgs(params);
      if (!parsed) {
        throw new Error("ask_user: invalid or empty questions");
      }
      const answersText = await waitForAnswers(parsed.questions);
      return {
        content: [{ type: "text" as const, text: answersText }],
        details: {},
      };
    },
  });
}

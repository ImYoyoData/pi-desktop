import { Type, type Static } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { ASK_USER_TOOL_NAME, parseAskUserArgs } from "../shared/ask-user";

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
                "If true, selecting this option shows a free-text field (prefer last option for single/multi)",
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

const ACK =
  "Questions shown to the user. Await their next message with answers.";

export function createAskUserToolDefinition() {
  return defineTool({
    name: ASK_USER_TOOL_NAME,
    label: "Ask user",
    description:
      "Show an interactive question strip in Pi Desktop (single-select, multi-select, or buttons). Call when you need a clarifying choice. Turn ends after this tool; the user replies with a message starting with [ask_user answers].",
    promptSnippet:
      "Ask the user structured single/multi/button questions in the desktop UI",
    promptGuidelines: [
      "Use ask_user instead of only asking clarifying choices in prose when a discrete choice is needed.",
      "For free-text 'other', set allowCustom on the last option of single/multi.",
      "After ask_user returns, stop and wait for the user's next message.",
    ],
    parameters: askUserSchema,
    async execute(_toolCallId, params) {
      const parsed = parseAskUserArgs(params);
      if (!parsed) {
        throw new Error("ask_user: invalid or empty questions");
      }
      return {
        content: [{ type: "text" as const, text: ACK }],
      };
    },
  });
}

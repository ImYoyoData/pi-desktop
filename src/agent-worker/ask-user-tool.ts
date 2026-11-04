import { Type, type Static } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  ASK_USER_HEADER_MAX,
  ASK_USER_MAX_OPTIONS,
  ASK_USER_MAX_QUESTIONS,
  ASK_USER_MIN_OPTIONS,
  ASK_USER_RULES,
  ASK_USER_TOOL_NAME,
  parseAskUserArgs,
  type AskUserQuestion,
} from "../shared/ask-user";
import { rpcToMain } from "./main-rpc";

const askUserSchema = Type.Object({
  questions: Type.Array(
    Type.Object({
      id: Type.String({
        description: "Stable identifier for mapping answers (snake_case).",
      }),
      header: Type.String({
        maxLength: ASK_USER_HEADER_MAX,
        description:
          "Short header label shown in the UI (12 or fewer chars). It is the tab label users pick questions by.",
      }),
      prompt: Type.String({
        description: "Single-sentence question shown to the user.",
      }),
      type: Type.Union([
        Type.Literal("single"),
        Type.Literal("multi"),
        Type.Literal("buttons"),
      ]),
      skippable: Type.Optional(
        Type.Boolean({
          description:
            "Whether the user may skip this question. Omitted = skippable. Set false only for hard requirements (e.g. a confirm/reject gate) — otherwise users can and often will skip.",
        }),
      ),
      isSecret: Type.Optional(
        Type.Boolean({
          description:
            "Mask this question's free-text answer in the UI (passwords, tokens, keys). The answer still reaches the tool result.",
        }),
      ),
      options: Type.Array(
        Type.Object({
          id: Type.String(),
          label: Type.String({
            description: "User-facing label (1-5 words).",
          }),
          description: Type.Optional(
            Type.String({
              description:
                "One short sentence explaining impact/tradeoff if selected (renders under the label).",
            }),
          ),
          allowCustom: Type.Optional(
            Type.Boolean({
              description:
                "If true, selecting this option lets the user add extra detail in the answer box.",
            }),
          ),
        }),
        {
          minItems: ASK_USER_MIN_OPTIONS,
          maxItems: ASK_USER_MAX_OPTIONS,
          description:
            'Provide 2-3 mutually exclusive choices. Put the recommended option first and suffix its label with "(Recommended)". Do not include an "Other" option in this list; the client adds a free-form "None of the above" option automatically.',
        },
      ),
    }),
    {
      minItems: 1,
      maxItems: ASK_USER_MAX_QUESTIONS,
      description: "Questions to show the user. Prefer 1 and do not exceed 3.",
    },
  ),
});

export type AskUserToolInput = Static<typeof askUserSchema>;

export type AskUserAnswers = {
  text: string;
  /** 用户随回答附上的图片（base64），作为 image content 交给模型。 */
  images?: { data: string; mimeType: string }[];
};

export type AskUserWaitForAnswers = (
  questions: AskUserQuestion[],
  signal?: AbortSignal,
  toolCallId?: string,
) => Promise<string | AskUserAnswers>;

function normalizeAnswers(raw: string | AskUserAnswers): AskUserAnswers {
  if (typeof raw === "string") return { text: raw.trim() };
  return { text: raw.text.trim(), images: raw.images ?? [] };
}

async function defaultWaitForAnswers(
  questions: AskUserQuestion[],
  signal?: AbortSignal,
  toolCallId?: string,
): Promise<string | AskUserAnswers> {
  // No auto-timeout: the ask waits until the user answers or the turn is
  // aborted (Stop). Passing null (NOT undefined — undefined triggers the
  // default timeout) disables the RPC timer. Aborting rejects the RPC so the
  // tool returns an error and the agent turn ends cleanly.
  const raw = await rpcToMain(
    "desktop.askUser",
    { questions, ...(toolCallId ? { toolCallId } : {}) },
    null,
    signal,
  );

  if (typeof raw === "string") {
    if (!raw.trim()) throw new Error("ask_user: no answers from user");
    return raw;
  }
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const text = typeof row?.text === "string" ? row.text.trim() : "";
  if (!text) {
    throw new Error("ask_user: no answers from user");
  }
  const images = Array.isArray(row?.images)
    ? row.images.filter(
        (img): img is { data: string; mimeType: string } =>
          Boolean(img) &&
          typeof (img as { data?: unknown }).data === "string" &&
          typeof (img as { mimeType?: unknown }).mimeType === "string",
      )
    : [];
  return { text, images };
}

export function createAskUserToolDefinition(deps?: {
  waitForAnswers?: AskUserWaitForAnswers;
}) {
  const waitForAnswers = deps?.waitForAnswers ?? defaultWaitForAnswers;
  return defineTool({
    name: ASK_USER_TOOL_NAME,
    label: "Ask user",
    description:
      'Ask the user 1-3 short questions and wait for the response. Each question takes 2-3 mutually exclusive options; the client adds a free-form "None of the above" choice. The user may skip any skippable question.',
    promptSnippet:
      "Ask the user 1-3 short questions with 2-3 options each and wait for the answers",
    promptGuidelines: [...ASK_USER_RULES],
    executionMode: "sequential",
    parameters: askUserSchema,
    async execute(toolCallId, params, signal) {
      const parsed = parseAskUserArgs(params);
      if (!parsed) {
        throw new Error(
          "ask_user: need 1-3 questions, each with a unique id, a header (<=12 chars), a prompt, and 2-3 options",
        );
      }
      const answers = normalizeAnswers(
        await waitForAnswers(parsed.questions, signal, toolCallId),
      );
      if (!answers.text) {
        throw new Error("ask_user: no answers from user");
      }
      return {
        content: [
          { type: "text" as const, text: answers.text },
          ...(answers.images ?? []).map((img) => ({
            type: "image" as const,
            data: img.data,
            mimeType: img.mimeType,
          })),
        ],
        details: {},
      };
    },
  });
}

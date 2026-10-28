import { Type, type Static } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  ASK_USER_TOOL_NAME,
  parseAskUserArgs,
  type AskUserQuestion,
} from "../shared/ask-user";
import { rpcToMain } from "./main-rpc";

const askUserSchema = Type.Object({
  questions: Type.Array(
    Type.Object({
      id: Type.String({ description: "Stable question id" }),
      title: Type.Optional(
        Type.String({
          description:
            "Short tab label, at most 4 characters, e.g. '目标', '范围'. The card truncates longer titles.",
        }),
      ),
      prompt: Type.String({ description: "Question shown to the user" }),
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
      options: Type.Array(
        Type.Object({
          id: Type.String(),
          label: Type.String(),
          description: Type.Optional(
            Type.String({
              description:
                "Optional one-line explanation under the label (what picking this option implies).",
            }),
          ),
          allowCustom: Type.Optional(
            Type.Boolean({
              description:
                "If true, selecting this option lets the user add extra detail in the answer box. The card always shows a free-text answer box, so users can also answer without picking an option.",
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

export type AskUserAnswers = {
  text: string;
  /** 用户随回答附上的图片（base64），作为 image content 交给模型。 */
  images?: { data: string; mimeType: string }[];
};

export type AskUserWaitForAnswers = (
  questions: AskUserQuestion[],
  signal?: AbortSignal,
) => Promise<string | AskUserAnswers>;

function normalizeAnswers(raw: string | AskUserAnswers): AskUserAnswers {
  if (typeof raw === "string") return { text: raw.trim() };
  return { text: raw.text.trim(), images: raw.images ?? [] };
}

async function defaultWaitForAnswers(
  questions: AskUserQuestion[],
  signal?: AbortSignal,
): Promise<string | AskUserAnswers> {
  // No auto-timeout: the ask waits until the user answers or the turn is
  // aborted (Stop). Passing null (NOT undefined — undefined triggers the
  // default timeout) disables the RPC timer. Aborting rejects the RPC so the
  // tool returns an error and the agent turn ends cleanly.
  const raw = await rpcToMain("desktop.askUser", { questions }, null, signal);

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
      "Show an interactive question wizard in Pi Desktop (single-select, multi-select, or buttons). The user may skip any skippable question. Blocks until the user submits. Prefer one call with multiple questions over many sequential calls.",
    promptSnippet:
      "Ask the user structured single/multi/button questions and wait for all answers",
    promptGuidelines: [
      "Use ask_user instead of only asking clarifying choices in prose when a discrete choice is needed.",
      "Put multiple related questions in one ask_user call; the UI collects all answers before continuing.",
      "Users can and often will skip questions — questions default to skippable. Set skippable:false only when an answer is a hard requirement (e.g. a confirm/reject gate).",
      "Desktop always appends a “custom input” option to every question (single/multi/buttons), even when an option already sets allowCustom; you may also set allowCustom on an option of any type to let the user add optional detail. In plan/task confirm dialogs, mark the adjust/revise option allowCustom so the user can type adjustment instructions.",
      "Always give each question a short `title` (at most 4 characters, e.g. 'Goal', 'Scope') — it is the tab label the user picks questions by. Put the full question in `prompt`.",
      "Use option `description` for a one-line explanation of what picking that option implies — it renders under the label.",
      "Option labels are plain text — no emoji, icons, or decorative symbols.",
      "Do not invent answers — ask_user blocks until the user submits.",
      "Answers list every question; skipped ones are marked '[skipped]'. Never re-ask a skipped question on your own — proceed with what you have or state what is missing.",
    ],
    executionMode: "sequential",
    parameters: askUserSchema,
    async execute(_toolCallId, params, signal) {
      const parsed = parseAskUserArgs(params);
      if (!parsed) {
        throw new Error("ask_user: invalid or empty questions");
      }
      const answers = normalizeAnswers(await waitForAnswers(parsed.questions, signal));
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

export type AskUserQuestionType = "single" | "multi" | "buttons";

export type AskUserOption = {
  id: string;
  label: string;
  /** 选项副标题：一句话说明这个选择意味着什么。 */
  description?: string;
  allowCustom?: boolean;
};

export type AskUserQuestion = {
  id: string;
  /** 顶部 tab 的短标签（≤12 字符）；缺省显示题干截断。 */
  header?: string;
  /** 旧字段名，等价于 header，仅为兼容。 */
  title?: string;
  prompt: string;
  type: AskUserQuestionType;
  options: AskUserOption[];
  /**
   * Whether the user may skip this question. Omitted = skippable (default).
   * Set false for hard requirements (e.g. plan/task confirm/reject gates).
   */
  skippable?: boolean;
  /** 敏感答案：界面遮蔽输入内容。 */
  isSecret?: boolean;
};

export type AskUserAnswerPayload = {
  text: string;
  /** 用户随回答附上的图片（base64），作为 image content 交给模型。 */
  images?: { data: string; mimeType: string }[];
};

/** 工具结果归一化：字符串或 { text, images } 统一成去空白的结构。 */
export function normalizeAskUserAnswers(
  raw: string | AskUserAnswerPayload,
): AskUserAnswerPayload {
  if (typeof raw === "string") return { text: raw.trim() };
  return { text: raw.text.trim(), images: raw.images ?? [] };
}

export const ASK_USER_HEADER_MAX = 12;
export const ASK_USER_MAX_QUESTIONS = 3;
export const ASK_USER_MIN_OPTIONS = 2;
export const ASK_USER_MAX_OPTIONS = 3;

export type AskUserPrompt = {
  questions: AskUserQuestion[];
  /** Present when the strip is driven by a blocking worker RPC. */
  sessionId?: string;
  requestId?: string;
  /** 发起这次提问的工具调用 id，用于把问答卡挂到对应的工具行。 */
  toolCallId?: string;
};

/** 回答时随附的截图：作为 image content 交给模型。 */
export type AskUserAttachment = {
  id: string;
  name: string;
  dataUrl: string;
};

/** Per-question UI draft keyed by question id. */
export type AskUserAnswerDraft = Record<
  string,
  {
    optionIds: string[];
    customText: string;
    /** True when the user skipped this question (no option selected). */
    skipped: boolean;
  }
>;

/** 客户端始终追加的 free-form 行（界面显示为“以上都不是”）。 */
export const ASK_USER_CUSTOM_OPTION_ID = "__custom__";

/** Questions default to skippable; only explicit `skippable:false` forces an answer. */
export function questionSkippable(q: AskUserQuestion): boolean {
  return q.skippable !== false;
}

/** Main → renderer ask / cancel. */
export type AskUserAskPrompt = {
  sessionId: string;
  requestId: string;
  questions: AskUserQuestion[];
  toolCallId?: string;
};

export type AskUserAskCancelled = {
  sessionId: string;
  requestId: string;
  cancelled: true;
};

export type AskUserAskRequest = AskUserAskPrompt | AskUserAskCancelled;

export type AskUserAskReply = {
  requestId: string;
  /** `{"answers":{"<question id>":{"answers":[...]}}}` returned to the tool. */
  answersJson: string;
  /** 随回答提交的图片（data URL），作为 image content 一并给模型。 */
  images?: string[];
};

export function isAskUserAskCancelled(
  req: AskUserAskRequest,
): req is AskUserAskCancelled {
  return "cancelled" in req && req.cancelled === true;
}

import { asRecord } from "./objects";

function parseOption(raw: unknown): AskUserOption | null {
  const o = asRecord(raw);
  if (!o) return null;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const label = typeof o.label === "string" ? o.label.trim() : "";
  if (!id || !label) return null;
  const description =
    typeof o.description === "string" ? o.description.trim() : "";
  return {
    id,
    label,
    ...(description ? { description } : {}),
    ...(o.allowCustom === true ? { allowCustom: true } : {}),
  };
}

/** 每题都补一条“以上都不是”选项：客户端始终提供自由输入入口。 */
export function withEnsuredCustomOption(q: AskUserQuestion): AskUserQuestion {
  if (q.options.some((o) => o.id === ASK_USER_CUSTOM_OPTION_ID)) return q;
  return {
    ...q,
    options: [
      ...q.options,
      {
        id: ASK_USER_CUSTOM_OPTION_ID,
        label: "None of the above",
        allowCustom: true,
      },
    ],
  };
}

const RECOMMENDED_SUFFIX = /\s*\((?:recommended|推荐)\)\s*$/iu;

/** 拆出 label 结尾的 “(Recommended)”，界面改用徽章展示。 */
export function splitRecommendedLabel(label: string): {
  text: string;
  recommended: boolean;
} {
  const match = RECOMMENDED_SUFFIX.exec(label);
  if (!match) return { text: label, recommended: false };
  return { text: label.slice(0, match.index).trim() || label, recommended: true };
}

function parseQuestion(raw: unknown): AskUserQuestion | null {
  const q = asRecord(raw);
  if (!q) return null;
  const id = typeof q.id === "string" ? q.id.trim() : "";
  const prompt = typeof q.prompt === "string" ? q.prompt.trim() : "";
  const type = q.type;
  if (!id || !prompt) return null;
  if (type !== "single" && type !== "multi" && type !== "buttons") return null;
  if (!Array.isArray(q.options)) return null;
  const options: AskUserOption[] = [];
  const seen = new Set<string>();
  for (const item of q.options) {
    const opt = parseOption(item);
    if (!opt) continue;
    // 客户端自动补齐的自定义选项不计入上限，否则 worker→main 二次解析会超限。
    if (opt.id === ASK_USER_CUSTOM_OPTION_ID) continue;
    if (seen.has(opt.id)) continue;
    seen.add(opt.id);
    options.push(opt);
  }
  if (options.length < ASK_USER_MIN_OPTIONS) return null;
  if (options.length > ASK_USER_MAX_OPTIONS) return null;
  const rawHeader =
    typeof q.header === "string"
      ? q.header
      : typeof q.title === "string"
        ? q.title
        : "";
  const header = rawHeader.trim().slice(0, ASK_USER_HEADER_MAX);
  return withEnsuredCustomOption({
    id,
    ...(header ? { header } : {}),
    prompt,
    type,
    options,
    ...(q.skippable === false ? { skippable: false } : {}),
    ...(q.isSecret === true ? { isSecret: true } : {}),
  });
}

/** Returns null if args are unusable for UI (bad count, duplicate ids, invalid question). */
export function parseAskUserArgs(args: unknown): AskUserPrompt | null {
  const root = asRecord(args);
  if (!root || !Array.isArray(root.questions) || root.questions.length === 0) return null;
  if (root.questions.length > ASK_USER_MAX_QUESTIONS) return null;
  const questions: AskUserQuestion[] = [];
  const seenQ = new Set<string>();
  for (const item of root.questions) {
    const q = parseQuestion(item);
    if (!q) return null;
    if (seenQ.has(q.id)) return null;
    seenQ.add(q.id);
    questions.push(q);
  }
  if (questions.length === 0) return null;
  return { questions };
}

/** 校验失败原因码，由渲染层翻译成界面语言。 */
export type AskUserValidationError =
  | "missing-answer"
  | "cannot-skip"
  | "select-one"
  | "invalid-option"
  | "custom-required";

export function validateAskUserAnswers(
  prompt: AskUserPrompt,
  draft: AskUserAnswerDraft,
): AskUserValidationError | null {
  for (const q of prompt.questions) {
    const ans = draft[q.id];
    if (!ans) {
      return "missing-answer";
    }
    // A skipped question is valid unless the model marked it as required.
    if (ans.skipped) {
      if (questionSkippable(q)) continue;
      return "cannot-skip";
    }
    const selected = q.options.filter((o) => ans.optionIds.includes(o.id));
    if (selected.length !== ans.optionIds.length) {
      return "invalid-option";
    }
    // 常驻的自定义回答框只要写了字就算作答，无需再勾选项。
    const custom = ans.customText.trim();
    if (custom) continue;
    if (selected.some((o) => o.id === ASK_USER_CUSTOM_OPTION_ID)) {
      return "custom-required";
    }
    if (ans.optionIds.length === 0) {
      return "missing-answer";
    }
    if (q.type === "single" || q.type === "buttons") {
      if (ans.optionIds.length !== 1) {
        return "select-one";
      }
    }
  }
  return null;
}

/** Validate a single question (wizard step). */
export function validateAskUserQuestionAnswer(
  q: AskUserQuestion,
  draft: AskUserAnswerDraft,
): AskUserValidationError | null {
  return validateAskUserAnswers({ questions: [q] }, draft);
}

/**
 * Codex 风格的答案结构：`{"answers":{"<id>":{"answers":[...]}}}`。
 * 空数组表示用户没有作答（跳过）该题。
 */
export function formatAskUserAnswers(
  prompt: AskUserPrompt,
  draft: AskUserAnswerDraft,
): string {
  const answers: Record<string, { answers: string[] }> = {};
  for (const q of prompt.questions) {
    const ans = draft[q.id];
    if (!ans || ans.skipped) {
      answers[q.id] = { answers: [] };
      continue;
    }
    const selected = q.options.filter(
      (o) => ans.optionIds.includes(o.id) && o.id !== ASK_USER_CUSTOM_OPTION_ID,
    );
    const list = selected.map((o) => o.label);
    const custom = ans.customText.trim();
    if (custom) list.push(custom);
    answers[q.id] = { answers: list };
  }
  return JSON.stringify({ answers });
}

export const ASK_USER_TOOL_NAME = "ask_user";

/** ask_user 的唯一规则文案：工具定义与桌面 system prompt 共用同一份。 */
export const ASK_USER_RULES: readonly string[] = [
  "Use ask_user instead of only asking clarifying choices in prose when a discrete choice is needed.",
  "Prefer one question; never send more than 3. Every question needs a unique id, a short header, a prompt, and 2-3 mutually exclusive options.",
  "Give each question a short `header` (12 or fewer chars) — it is the tab label the user picks questions by. Put the full sentence in `prompt`.",
  'Put the recommended option first and suffix its label with "(Recommended)" — the card renders it as a Recommended badge.',
  'Do not add an "Other" option yourself; the client appends "None of the above" with a free-text box, and text typed there alone counts as the answer.',
  "Use option `description` for a one-line explanation of what picking this option implies — it renders under the label.",
  "Set `isSecret: true` when the answer is sensitive (password, token, key): the card masks the free-text input.",
  "Put multiple related questions in one ask_user call; the UI collects all answers before continuing.",
  "The UI blocks until the user answers and submits once.",
  "Users can and often will skip questions — questions default to skippable. Expect skipped answers and never re-ask them on your own.",
  "Set `skippable: false` only for hard requirements (e.g. a confirm/reject gate); in plan/task confirms mark the adjust/revise option `allowCustom: true` so the user can type instructions.",
  "Option labels are plain text — no emoji, icons, or decorative symbols.",
  "Do not invent answers — ask_user blocks until the user submits.",
  'The tool result is JSON: `{"answers":{"<question id>":{"answers":["<selected option label>","<free text>"]}}}`. An empty `answers` array means the user skipped that question; proceed with what you have or state what is missing.',
  "Users may paste screenshots into the card; attached images arrive as image content next to the JSON answer.",
];

/** 单张图片 data URL 上限：约 6MB 原图 base64 后的长度，超过直接拒绝。 */
const IMAGE_DATA_URL_MAX_LENGTH = 8 * 1024 * 1024;
const IMAGE_DATA_URL = /^data:(image\/[\w.+-]+);base64,([\s\S]+)$/;

/** data URL → 传给模型的 base64 图片内容；格式不对返回 null。 */
export function imageDataFromDataUrl(
  dataUrl: string,
): { data: string; mimeType: string } | null {
  if (dataUrl.length > IMAGE_DATA_URL_MAX_LENGTH) return null;
  const match = IMAGE_DATA_URL.exec(dataUrl.trim());
  if (!match?.[1] || !match[2]) return null;
  const data = match[2].trim();
  if (!data) return null;
  return { data, mimeType: match[1].trim() };
}
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
  /** 顶部 tab 的短标签；缺省显示“问题 N”。 */
  title?: string;
  prompt: string;
  type: AskUserQuestionType;
  options: AskUserOption[];
  /**
   * Whether the user may skip this question. Omitted = skippable (default).
   * Set false for hard requirements (e.g. plan/task confirm/reject gates).
   */
  skippable?: boolean;
};

export type AskUserPrompt = {
  questions: AskUserQuestion[];
  /** Present when the strip is driven by a blocking worker RPC. */
  sessionId?: string;
  requestId?: string;
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

/** Injected when the model omitted a free-text option (single/multi). */
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
};

export type AskUserAskCancelled = {
  sessionId: string;
  requestId: string;
  cancelled: true;
};

export type AskUserAskRequest = AskUserAskPrompt | AskUserAskCancelled;

export type AskUserAskReply = {
  requestId: string;
  /** Formatted `[ask_user answers]` text returned to the tool. */
  answersText: string;
  /** 随回答提交的图片（data URL），作为 image content 一并给模型。 */
  images?: string[];
};

export function isAskUserAskCancelled(
  req: AskUserAskRequest,
): req is AskUserAskCancelled {
  return "cancelled" in req && req.cancelled === true;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

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

/** 每题都补一条“自定义输入”选项：选项清单里总有自定义入口。 */
export function withEnsuredCustomOption(q: AskUserQuestion): AskUserQuestion {
  if (q.options.some((o) => o.id === ASK_USER_CUSTOM_OPTION_ID)) return q;
  return {
    ...q,
    options: [
      ...q.options,
      {
        id: ASK_USER_CUSTOM_OPTION_ID,
        label: "Custom",
        allowCustom: true,
      },
    ],
  };
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
    if (seen.has(opt.id)) continue;
    seen.add(opt.id);
    options.push(opt);
  }
  if (options.length === 0) return null;
  const title = typeof q.title === "string" ? q.title.trim() : "";
  return withEnsuredCustomOption({
    id,
    ...(title ? { title } : {}),
    prompt,
    type,
    options,
    ...(q.skippable === false ? { skippable: false } : {}),
  });
}

/** Returns null if args are unusable for UI. */
export function parseAskUserArgs(args: unknown): AskUserPrompt | null {
  const root = asRecord(args);
  if (!root || !Array.isArray(root.questions) || root.questions.length === 0) return null;
  const questions: AskUserQuestion[] = [];
  const seenQ = new Set<string>();
  for (const item of root.questions) {
    const q = parseQuestion(item);
    if (!q) continue;
    if (seenQ.has(q.id)) continue;
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

export function formatAskUserAnswers(
  prompt: AskUserPrompt,
  draft: AskUserAnswerDraft,
): string {
  const lines = ["[ask_user answers]"];
  prompt.questions.forEach((q, i) => {
    const ans = draft[q.id];
    // Skipped questions are still listed so the model knows the user chose
    // not to answer (option B) and must not silently re-ask.
    if (!ans || ans.skipped) {
      lines.push(`${i + 1}. (id=${q.id}) ${q.prompt} → [skipped]`);
      return;
    }
    const selected = q.options.filter(
      (o) => ans.optionIds.includes(o.id) && o.id !== ASK_USER_CUSTOM_OPTION_ID,
    );
    const labels = selected.map((o) => o.label).join(", ");
    const custom = ans.customText.trim();
    const answer = [labels, custom ? `custom: ${custom}` : ""].filter(Boolean).join("; ");
    lines.push(`${i + 1}. (id=${q.id}) ${q.prompt} → ${answer || "[no answer]"}`);
  });
  return lines.join("\n");
}

export const ASK_USER_TOOL_NAME = "ask_user";

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
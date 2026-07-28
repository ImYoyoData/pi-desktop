export type AskUserQuestionType = "single" | "multi" | "buttons";

export type AskUserOption = {
  id: string;
  label: string;
  allowCustom?: boolean;
};

export type AskUserQuestion = {
  id: string;
  prompt: string;
  type: AskUserQuestionType;
  options: AskUserOption[];
};

export type AskUserPrompt = {
  questions: AskUserQuestion[];
};

/** Per-question UI draft keyed by question id. */
export type AskUserAnswerDraft = Record<
  string,
  {
    optionIds: string[];
    customText: string;
  }
>;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function parseOption(raw: unknown): AskUserOption | null {
  const o = asRecord(raw);
  if (!o) return null;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const label = typeof o.label === "string" ? o.label.trim() : "";
  if (!id || !label) return null;
  return {
    id,
    label,
    ...(o.allowCustom === true ? { allowCustom: true } : {}),
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
  return { id, prompt, type, options };
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

export function validateAskUserAnswers(
  prompt: AskUserPrompt,
  draft: AskUserAnswerDraft,
): string | null {
  for (const q of prompt.questions) {
    const ans = draft[q.id];
    if (!ans || ans.optionIds.length === 0) {
      return `Missing answer for: ${q.prompt}`;
    }
    if (q.type === "single" || q.type === "buttons") {
      if (ans.optionIds.length !== 1) {
        return `Select exactly one option for: ${q.prompt}`;
      }
    }
    const selected = q.options.filter((o) => ans.optionIds.includes(o.id));
    if (selected.length !== ans.optionIds.length) {
      return `Invalid option for: ${q.prompt}`;
    }
    const needsCustom = selected.some((o) => o.allowCustom);
    if (needsCustom && !ans.customText.trim()) {
      return `Custom text required for: ${q.prompt}`;
    }
  }
  return null;
}

export function formatAskUserAnswers(
  prompt: AskUserPrompt,
  draft: AskUserAnswerDraft,
): string {
  const lines = ["[ask_user answers]"];
  prompt.questions.forEach((q, i) => {
    const ans = draft[q.id]!;
    const selected = q.options.filter((o) => ans.optionIds.includes(o.id));
    const labels = selected.map((o) => o.label).join(", ");
    const needsCustom = selected.some((o) => o.allowCustom);
    const custom =
      needsCustom && ans.customText.trim()
        ? `; custom: ${ans.customText.trim()}`
        : "";
    lines.push(`${i + 1}. (id=${q.id}) ${q.prompt} → ${labels}${custom}`);
  });
  return lines.join("\n");
}

export const ASK_USER_TOOL_NAME = "ask_user";

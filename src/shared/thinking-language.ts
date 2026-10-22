/**
 * 思考语言（移植 Reasonix 的 reasoning_language）：只约束可见思考/推理文本。
 *
 * 以临时用户消息块注入，不写入系统提示词，保持缓存前缀稳定。
 * 默认档位不注入任何指令块。
 */

export type ThinkingLanguage = "default" | "zh";

export const THINKING_LANGUAGES: readonly ThinkingLanguage[] = ["default", "zh"];

export type ThinkingLanguageSettings = {
  language: ThinkingLanguage;
};

export const DEFAULT_THINKING_LANGUAGE_SETTINGS: ThinkingLanguageSettings = {
  language: "default",
};

const REASONING_LANGUAGE_OPEN = "<reasoning-language>";
const REASONING_LANGUAGE_CLOSE = "</reasoning-language>";

const ZH_THINKING_LANGUAGE_BLOCK = `${REASONING_LANGUAGE_OPEN}
必须使用简体中文书写全部可见思考/推理文本：从第一个字开始就用中文，并在整轮内保持中文，即使系统提示词、工具说明、工具输出或引用的代码是英文。代码、标识符、文件路径、shell 命令和未翻译的技术术语保持原文。此要求只约束可见思考文本，不覆盖用户对最终回答语言的明确要求。
${REASONING_LANGUAGE_CLOSE}`;

export function isThinkingLanguage(value: unknown): value is ThinkingLanguage {
  return value === "default" || value === "zh";
}

/** 容错解析档位；未知值（含旧版 en/auto）回退默认。 */
export function normalizeThinkingLanguage(value: unknown): ThinkingLanguage {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "zh" || raw === "cn" || raw === "chinese" || raw === "中文") {
    return "zh";
  }
  return "default";
}

/** 容错解析设置文件；损坏或未知值回退默认。 */
export function parseThinkingLanguageSettings(raw: unknown): ThinkingLanguageSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_THINKING_LANGUAGE_SETTINGS };
  }
  return { language: normalizeThinkingLanguage((raw as { language?: unknown }).language) };
}

/** 可见思考语言指令块；默认档位不注入，返回空串。 */
export function thinkingLanguageBlock(setting: unknown): string {
  return normalizeThinkingLanguage(setting) === "zh" ? ZH_THINKING_LANGUAGE_BLOCK : "";
}

/** 消息是否已经以思考语言块开头。 */
export function hasThinkingLanguageBlock(text: string): boolean {
  return (text ?? "").trimStart().startsWith(REASONING_LANGUAGE_OPEN);
}

/** 剥离消息开头的思考语言块；没有块时原样返回（不改变空白）。 */
export function stripThinkingLanguageBlock(text: string): string {
  let rest = text ?? "";
  for (;;) {
    const lead = rest.trimStart();
    if (!lead.startsWith(REASONING_LANGUAGE_OPEN)) return rest;
    const end = lead.indexOf(REASONING_LANGUAGE_CLOSE);
    if (end < 0) return rest;
    rest = lead.slice(end + REASONING_LANGUAGE_CLOSE.length).replace(/^\s+/, "");
  }
}

/**
 * 会话级模型 / 思考等级偏好的读写与解析 —— 纯函数。
 *
 * localStorage 的边界留在调用方（组件用 utils/prefs），这里只处理
 * 不可变更新、序列化，以及对外部 unknown 的防御性解析。
 */

import type { ThinkingLevel } from "../../../shared/thinking-level";

export const SESSION_PREFS_KEY = "pi-desktop:session-model-prefs";

/** 未创建的新会话草稿用稳定键记住模型/思考等级，发送后自动沿用到真实会话。 */
export const DRAFT_PREF_KEY = "__draft__";

export type SessionPrefs = {
  models: Record<string, string>;
  thinking: Record<string, ThinkingLevel>;
};

export const EMPTY_SESSION_PREFS: SessionPrefs = { models: {}, thinking: {} };

export function parseSessionPrefs(raw: string | null): SessionPrefs {
  if (!raw) return EMPTY_SESSION_PREFS;
  try {
    const parsed = JSON.parse(raw) as Partial<SessionPrefs>;
    return {
      models: parsed.models && typeof parsed.models === "object" ? parsed.models : {},
      thinking:
        parsed.thinking && typeof parsed.thinking === "object"
          ? (parsed.thinking as Record<string, ThinkingLevel>)
          : {},
    };
  } catch {
    return EMPTY_SESSION_PREFS;
  }
}

export function serializeSessionPrefs(prefs: SessionPrefs): string {
  return JSON.stringify({ models: prefs.models, thinking: prefs.thinking });
}

/** 不可变写入；键已存在时值相同则返回原引用，避免无谓的重渲染。 */
export function setPrefKey<K extends "models" | "thinking">(
  prefs: SessionPrefs,
  field: K,
  key: string,
  value: SessionPrefs[K][string],
): SessionPrefs {
  if (prefs[field][key] === value) return prefs;
  return { ...prefs, [field]: { ...prefs[field], [key]: value } };
}

/** 不可变删除；键不存在时返回原引用。 */
export function forgetPrefKey(prefs: SessionPrefs, key: string): SessionPrefs {
  if (!(key in prefs.models) && !(key in prefs.thinking)) return prefs;
  const models = { ...prefs.models };
  const thinking = { ...prefs.thinking };
  delete models[key];
  delete thinking[key];
  return { models, thinking };
}

/**
 * 从 session state（worker 侧回传的 unknown）提取 `provider/id`。
 * 逐层校验，缺字段或非字符串一律视为无值。
 */
export function modelKeyFromState(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const model = (data as { model?: unknown }).model;
  if (!model || typeof model !== "object") return null;
  const m = model as { provider?: unknown; id?: unknown };
  if (typeof m.provider !== "string" || typeof m.id !== "string") return null;
  if (!m.provider || !m.id) return null;
  return `${m.provider}/${m.id}`;
}

export function thinkingFromState(
  data: unknown,
  isThinkingLevel: (v: unknown) => v is ThinkingLevel,
): ThinkingLevel | null {
  if (!data || typeof data !== "object") return null;
  const level = (data as { thinkingLevel?: unknown }).thinkingLevel;
  return isThinkingLevel(level) ? level : null;
}

/**
 * worker 按模型能力 clamp 档位后回传实际值。
 * 返回被 clamp 后的实际档位；worker 未回传合法值时返回 requested（界面不动）。
 */
export function resolveThinkingResult(
  requested: ThinkingLevel,
  result: unknown,
  isThinkingLevel: (v: unknown) => v is ThinkingLevel,
): { actual: ThinkingLevel; clamped: boolean } {
  const raw = (result as { level?: unknown } | null)?.level;
  if (!isThinkingLevel(raw) || raw === requested) {
    return { actual: requested, clamped: false };
  }
  return { actual: raw, clamped: true };
}

/** 分组模型列表拍平，naive-ui 的 value 始终取叶子项。 */
export function flatModelOptions<T extends { label: string; value: string }>(
  groups: readonly (T | { type: "group"; label: string; key: string; children: T[] })[],
): T[] {
  return groups.flatMap((g) => ("children" in g ? g.children : [g]));
}
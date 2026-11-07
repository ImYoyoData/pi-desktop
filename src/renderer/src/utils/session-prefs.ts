/**
 * 会话级模型 / 思考等级偏好的读写与解析 —— 纯函数。
 *
 * localStorage 的边界留在调用方（组件用 utils/prefs），这里只处理
 * 不可变更新、序列化，以及对外部 unknown 的防御性解析。
 */

import type { AgentBackend } from "../../../shared/agent-backend";
import type { ThinkingLevel } from "../../../shared/thinking-level";

export const SESSION_PREFS_KEY = "pi-desktop:session-model-prefs";

/** 未创建的新会话草稿用稳定键记住模型/思考等级，发送后自动沿用到真实会话。 */
export const DRAFT_PREF_KEY = "__draft__";

/**
 * 模型偏好按引擎分键：pi 与 omp 的配置目录不同，`provider/id` 只在各自后端里成立。
 *
 * 同一个会话 id 下如果共用一条偏好，切引擎后会把 pi 的模型 id 传给 omp 的
 * set_model，直接报 `Model not found`，菜单也把该模型标成“已选中”。
 */
export function prefKeyForBackend(backend: AgentBackend, key: string): string {
	return `${backend}\u0000${key}`;
}

/** 键是否已经带引擎前缀。 */
export function hasBackendPrefix(key: string): boolean {
	return key.startsWith("pi\u0000") || key.startsWith("omp\u0000");
}

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

/**
 * 把引入引擎隔离之前的旧偏好（裸会话 id）搬到 `pi\0<id>`。
 *
 * 旧版本只有一个引擎能选模型，裸键实际属于 pi；omp 是后来才有的，而旧版里
 * 存的值可能本来就是 pi 的模型 id（正是本次要修的 bug）。所以只给 pi 搬、
 * omp 让它重新选——把 pi 的模型 id 搬进 omp 只会重现 `Model not found`。
 *
 * 返回 null 表示没有可搬的键（调用方不必写盘）。
 */
export function migrateLegacyPrefsToPi(prefs: SessionPrefs): SessionPrefs | null {
	const models: Record<string, string> = { ...prefs.models };
	const thinking: Record<string, ThinkingLevel> = { ...prefs.thinking };
	let changed = false;
	for (const [key, value] of Object.entries(prefs.models)) {
		if (hasBackendPrefix(key)) continue;
		const next = prefKeyForBackend("pi", key);
		if (!(next in models)) models[next] = value;
		delete models[key];
		changed = true;
	}
	for (const [key, value] of Object.entries(prefs.thinking)) {
		if (hasBackendPrefix(key)) continue;
		const next = prefKeyForBackend("pi", key);
		if (!(next in thinking)) thinking[next] = value;
		delete thinking[key];
		changed = true;
	}
	return changed ? { models, thinking } : null;
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
  if (!data || typeof data !== "object" || !("model" in data)) return null;
  const model = data.model;
  if (!model || typeof model !== "object") return null;
  if (!("provider" in model) || !("id" in model)) return null;
  const { provider, id } = model;
  if (typeof provider !== "string" || typeof id !== "string") return null;
  if (!provider || !id) return null;
  return `${provider}/${id}`;
}

export function thinkingFromState(
  data: unknown,
  isThinkingLevel: (v: unknown) => v is ThinkingLevel,
): ThinkingLevel | null {
  if (!data || typeof data !== "object" || !("thinkingLevel" in data)) return null;
  return isThinkingLevel(data.thinkingLevel) ? data.thinkingLevel : null;
}

/** 从 worker 的 get_state / set_thinking_level 结果读取真实可用档位。 */
export function thinkingLevelsFromWorker(
  data: unknown,
  isThinkingLevel: (v: unknown) => v is ThinkingLevel,
): ThinkingLevel[] | null {
  if (!data || typeof data !== "object" || !("thinkingLevels" in data)) return null;
  const raw = data.thinkingLevels;
  if (!Array.isArray(raw)) return null;
  const levels: ThinkingLevel[] = [];
  for (const value of raw) {
    if (isThinkingLevel(value) && !levels.includes(value)) levels.push(value);
  }
  return levels;
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

/** 分组模型列表拍平，选中值始终取叶子项。 */
export function flatModelOptions<T extends { label: string; value: string }>(
  groups: readonly (T | { type: "group"; label: string; key: string; children: T[] })[],
): T[] {
  return groups.flatMap((g) => ("children" in g ? g.children : [g]));
}
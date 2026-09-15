/**
 * 内置模型目录：用 Pi SDK 的模型元数据补全自定义端点拉取到的模型信息。
 *
 * 端点在 `/models` 里通常只给 id，偶尔给上下文/输出上限；内置目录覆盖主流
 * 模型家族，用来补齐这些缺失字段，端点自己报告的值优先。
 */

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { DiscoveredModel } from "../shared/model-discover";
import { inferModelCapabilities, resolveContextWindow } from "../shared/model-metadata";

export type CatalogModelMeta = {
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  vision?: boolean;
};

function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}

/** `vendor/model` 形态取最后一段，用于跨供应商别名匹配。 */
function lastSegment(id: string): string {
  const parts = normalizeId(id).split("/");
  return parts[parts.length - 1] ?? "";
}

/** 精确键：完整 id 与去掉 vendor 前缀的最后一段。 */
function exactKeys(id: string): string[] {
  const full = normalizeId(id);
  const last = lastSegment(full);
  return full === last ? [full] : [full, last];
}

/**
 * 宽松变体：点号转连字符、去掉小版本号。
 * 例：`deepseek/deepseek-v4.1-flash` 还能命中内置的 `deepseek-v4-flash`。
 */
function fuzzyKeys(id: string): string[] {
  const keys = new Set<string>();
  for (const base of exactKeys(id)) {
    if (!base.includes(".")) continue;
    const dashed = base.replace(/\./gu, "-");
    keys.add(dashed);
    keys.add(dashed.replace(/(\d+)-(\d+)/gu, "$1"));
  }
  return [...keys];
}

/**
 * 建立「模型 id → 元数据」索引。`excludeProviders` 用来跳过 models.json 里的
 * 自定义提供商，避免拿用户不完整的数据回填其它端点。
 */
export function buildCatalogIndex(
  runtime: ModelRuntime,
  excludeProviders: ReadonlySet<string>,
): Map<string, CatalogModelMeta> {
  const index = new Map<string, CatalogModelMeta>();
  for (const provider of runtime.getProviders()) {
    if (excludeProviders.has(provider.id)) continue;
    for (const model of provider.getModels()) {
      const meta: CatalogModelMeta = {
        ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
        ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
        ...(typeof model.reasoning === "boolean" ? { reasoning: model.reasoning } : {}),
        ...(Array.isArray(model.input) ? { vision: model.input.includes("image") } : {}),
      };
      const full = normalizeId(model.id);
      if (full && !index.has(full)) index.set(full, meta);
      const last = lastSegment(model.id);
      if (last && last !== full && !index.has(last)) index.set(last, meta);
    }
  }
  return index;
}

/** 命中信息；`exact` 为 false 表示只匹配到不同小版本的同族条目。 */
type CatalogHit = { meta: CatalogModelMeta; exact: boolean };

/** 按精确键、再按宽松变体查找内置元数据。 */
function findMeta(
  index: ReadonlyMap<string, CatalogModelMeta>,
  id: string,
): CatalogHit | undefined {
  for (const key of exactKeys(id)) {
    const meta = index.get(key);
    if (meta) return { meta, exact: true };
  }
  for (const key of fuzzyKeys(id)) {
    const meta = index.get(key);
    if (meta) return { meta, exact: false };
  }
  return undefined;
}

/** 补全发现结果中缺失的字段；端点报告的值与未知项保持原样。 */
export function enrichDiscoveredModels(
  models: DiscoveredModel[],
  index: ReadonlyMap<string, CatalogModelMeta>,
): DiscoveredModel[] {
  return models.map((model) => {
    const hit = findMeta(index, model.id);
    if (!hit) return model;
    const { meta, exact } = hit;
    // 宽松命中的是不同小版本的条目：多模态可能随版本新增，
    // 所以只在条目明确支持时才采信，否则留给启发式判断。
    const vision =
      model.vision === undefined && meta.vision !== undefined && (exact || meta.vision)
        ? meta.vision
        : model.vision;
    return {
      ...model,
      ...(model.contextWindow === undefined && meta.contextWindow
        ? { contextWindow: meta.contextWindow }
        : {}),
      ...(model.maxTokens === undefined && meta.maxTokens ? { maxTokens: meta.maxTokens } : {}),
      ...(model.reasoning === undefined && meta.reasoning !== undefined
        ? { reasoning: meta.reasoning }
        : {}),
      ...(vision !== undefined ? { vision } : {}),
    };
  });
}

/**
 * 对端点与内置目录都没给出能力的模型应用 id 启发式，让拉取弹窗展示的
 * 内容与勾选后写入的一致；最大输出不猜，未知时保持空。
 */
export function resolveDiscoveredModels(models: DiscoveredModel[]): DiscoveredModel[] {
  return models.map((model) => {
    const caps = inferModelCapabilities(model.id, {
      reasoning: model.reasoning,
      vision: model.vision,
    });
    const contextWindow = resolveContextWindow(model.contextWindow, model.id);
    return {
      ...model,
      reasoning: caps.reasoning,
      vision: caps.vision,
      ...(contextWindow ? { contextWindow } : {}),
    };
  });
}

/**
 * 内置模型目录：用 Pi SDK 的模型元数据补全自定义端点拉取到的模型信息。
 *
 * 端点在 `/models` 里通常只给 id，偶尔给上下文/输出上限；内置目录覆盖主流
 * 模型家族，用来补齐这些缺失字段，端点自己报告的值优先。
 */

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { DiscoveredModel } from "../shared/model-discover";

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

/** 补全发现结果中缺失的字段；端点报告的值与未知项保持原样。 */
export function enrichDiscoveredModels(
  models: DiscoveredModel[],
  index: ReadonlyMap<string, CatalogModelMeta>,
): DiscoveredModel[] {
  return models.map((model) => {
    const meta = index.get(normalizeId(model.id)) ?? index.get(lastSegment(model.id));
    if (!meta) return model;
    return {
      ...model,
      ...(model.contextWindow === undefined && meta.contextWindow
        ? { contextWindow: meta.contextWindow }
        : {}),
      ...(model.maxTokens === undefined && meta.maxTokens ? { maxTokens: meta.maxTokens } : {}),
      ...(model.reasoning === undefined && meta.reasoning !== undefined
        ? { reasoning: meta.reasoning }
        : {}),
      ...(model.vision === undefined && meta.vision !== undefined ? { vision: meta.vision } : {}),
    };
  });
}

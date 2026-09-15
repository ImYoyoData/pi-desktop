/**
 * Desktop-side model curation.
 *
 * Why this exists: Pi's `models.json` can *add* models to a built-in provider
 * (`provider-composer` keeps `baseModels` and upserts custom ids), but it cannot
 * remove any. A provider such as OpenRouter therefore always exposes its full
 * catalog — hundreds of entries — which makes the model menu unusable.
 *
 * So the GUI keeps its own per-provider selection and filters the list it
 * presents. Semantics:
 *  - provider absent from `providers` → not curated, show every available model
 *  - provider present with `[]`          → curated to nothing (hidden)
 *  - provider present with `["a","b"]`   → show exactly those
 */

import type { ModelsAvailableEntry } from "./models-settings";

export type ModelSelection = {
  /** providerId → curated model ids. */
  providers: Record<string, string[]>;
  /** 桌面端禁用的提供商；只影响 GUI，不改 models.json。 */
  disabled: string[];
};

export const EMPTY_MODEL_SELECTION: ModelSelection = { providers: {}, disabled: [] };

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Parse whatever was on disk into a valid selection (drops junk, dedupes ids). */
export function parseModelSelection(raw: unknown): ModelSelection {
  const root = asRecord(raw);
  const providersRaw = asRecord(root?.providers);
  const providers: Record<string, string[]> = {};
  if (providersRaw) {
    for (const [providerId, value] of Object.entries(providersRaw)) {
      const id = providerId.trim();
      if (!id || !Array.isArray(value)) continue;
      const ids: string[] = [];
      for (const item of value) {
        if (typeof item !== "string") continue;
        const modelId = item.trim();
        if (modelId && !ids.includes(modelId)) ids.push(modelId);
      }
      providers[id] = ids;
    }
  }
  const disabled: string[] = [];
  if (Array.isArray(root?.disabled)) {
    for (const item of root.disabled) {
      if (typeof item !== "string") continue;
      const id = item.trim();
      if (id && !disabled.includes(id)) disabled.push(id);
    }
  }
  return { providers, disabled };
}

/** True when the provider has an explicit curated list. */
export function isProviderCurated(selection: ModelSelection, providerId: string): boolean {
  return Object.prototype.hasOwnProperty.call(selection.providers, providerId.trim());
}

/** Curated ids for a provider, or null when it is not curated. */
export function providerSelection(
  selection: ModelSelection,
  providerId: string,
): string[] | null {
  const key = providerId.trim();
  return isProviderCurated(selection, key) ? [...(selection.providers[key] ?? [])] : null;
}

/**
 * Replace a provider's selection. Pass `null` to reset the provider back to
 * "show everything".
 */
export function withProviderSelection(
  selection: ModelSelection,
  providerId: string,
  ids: readonly string[] | null,
): ModelSelection {
  const key = providerId.trim();
  const providers = { ...selection.providers };
  if (ids === null) {
    delete providers[key];
  } else {
    const next: string[] = [];
    for (const raw of ids) {
      const id = raw.trim();
      if (id && !next.includes(id)) next.push(id);
    }
    providers[key] = next;
  }
  return { ...selection, providers };
}

/** 提供商是否已在桌面端禁用。 */
export function isProviderDisabled(selection: ModelSelection, providerId: string): boolean {
  return selection.disabled.includes(providerId.trim());
}

/** 开关桌面端的提供商禁用状态。 */
export function withProviderDisabled(
  selection: ModelSelection,
  providerId: string,
  disabled: boolean,
): ModelSelection {
  const key = providerId.trim();
  if (!key) return selection;
  const rest = selection.disabled.filter((id) => id !== key);
  return { ...selection, disabled: disabled ? [...rest, key] : rest };
}

/** Keep only the available models the user selected (uncurated providers pass through). */
export function filterAvailableModels<T extends Pick<ModelsAvailableEntry, "provider" | "id">>(
  available: readonly T[],
  selection: ModelSelection,
): T[] {
  return available.filter((m) => {
    if (selection.disabled.includes(m.provider)) return false;
    const curated = selection.providers[m.provider];
    if (curated === undefined) return true;
    return curated.includes(m.id);
  });
}

/** Prune curated ids that no longer exist upstream, so stale ids cannot hide a fresh list. */
export function pruneModelSelection(
  selection: ModelSelection,
  available: readonly Pick<ModelsAvailableEntry, "provider" | "id">[],
): ModelSelection {
  const liveByProvider = new Map<string, Set<string>>();
  for (const m of available) {
    const set = liveByProvider.get(m.provider) ?? new Set<string>();
    set.add(m.id);
    liveByProvider.set(m.provider, set);
  }
  const providers: Record<string, string[]> = {};
  for (const [providerId, ids] of Object.entries(selection.providers)) {
    const live = liveByProvider.get(providerId);
    // Drop a curated provider that vanished entirely, otherwise filter to live ids.
    if (!live) continue;
    providers[providerId] = ids.filter((id) => live.has(id));
  }
  return { providers, disabled: [...selection.disabled] };
}

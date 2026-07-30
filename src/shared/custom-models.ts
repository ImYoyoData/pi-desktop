/** Helpers for GUI editing of ~/.pi/agent/models.json custom providers (Pi-aligned). */

import { normalizeProviderBaseUrl } from "./model-discover";

export const CUSTOM_MODEL_APIS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const;

export type CustomModelApi = (typeof CUSTOM_MODEL_APIS)[number];

export type CustomModelEntry = {
  id: string;
  name: string;
  reasoning: boolean;
  /** Optional — defaults to SDK 128000 if omitted */
  contextWindow?: number;
  /** Optional — defaults to SDK 16384 if omitted */
  maxTokens?: number;
  /** When true, model accepts images (`input: ["text","image"]`). */
  vision?: boolean;
};

export type CustomProviderDraft = {
  /** Provider key in models.json */
  id: string;
  name: string;
  baseUrl: string;
  api: CustomModelApi;
  /**
   * UI field for the API key.
   * Remote keys are saved to auth.json (Pi `/login` style).
   * Local placeholders / `$ENV` / `!cmd` stay in models.json.
   */
  apiKey: string;
  supportsDeveloperRole: boolean;
  supportsReasoningEffort: boolean;
  models: CustomModelEntry[];
};

export type ModelsConfigDoc = {
  providers: Record<string, unknown>;
  /** Preserved top-level keys (e.g. modelOverrides). */
  rest: Record<string, unknown>;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function emptyCustomProvider(partial?: Partial<CustomProviderDraft>): CustomProviderDraft {
  return {
    id: "",
    name: "",
    baseUrl: "http://127.0.0.1:1234/v1",
    api: "openai-completions",
    apiKey: "",
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    models: [{ id: "", name: "", reasoning: false }],
    ...partial,
  };
}

export function parseModelsConfigText(text: string): ModelsConfigDoc {
  const raw = text.trim() ? JSON.parse(text) : { providers: {} };
  const root = asRecord(raw) ?? {};
  const providers = asRecord(root.providers) ?? {};
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(root)) {
    if (k === "providers") continue;
    rest[k] = v;
  }
  return { providers: { ...providers }, rest };
}

export function stringifyModelsConfig(doc: ModelsConfigDoc): string {
  return `${JSON.stringify({ ...doc.rest, providers: doc.providers }, null, 2)}\n`;
}

function parseApi(v: unknown): CustomModelApi {
  if (typeof v === "string" && (CUSTOM_MODEL_APIS as readonly string[]).includes(v)) {
    return v as CustomModelApi;
  }
  return "openai-completions";
}

function parsePositiveInt(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
  if (typeof v === "string" && /^\d+$/u.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  return undefined;
}

function modelHasVision(input: unknown): boolean {
  return Array.isArray(input) && input.includes("image");
}

function parseModelEntry(raw: unknown): CustomModelEntry | null {
  const o = asRecord(raw);
  if (!o) return null;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  if (!id) return null;
  const contextWindow = parsePositiveInt(o.contextWindow);
  const maxTokens = parsePositiveInt(o.maxTokens);
  return {
    id,
    name: typeof o.name === "string" ? o.name : "",
    reasoning: o.reasoning === true,
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxTokens ? { maxTokens } : {}),
    ...(modelHasVision(o.input) ? { vision: true } : {}),
  };
}

/**
 * Keys that belong in models.json per Pi docs (literal local placeholder, $ENV, !command).
 * Real remote secrets should go to auth.json instead.
 */
export function shouldStoreApiKeyInModelsJson(apiKey: string, baseUrl: string): boolean {
  const key = apiKey.trim();
  if (!key) return false;
  if (key.startsWith("$") || key.startsWith("!")) return true;
  try {
    const host = new URL(normalizeProviderBaseUrl(baseUrl) || baseUrl).hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) {
      return true;
    }
  } catch {
    // fall through
  }
  return false;
}

function defaultLocalCompatOff(baseUrl: string): boolean {
  try {
    const host = new URL(normalizeProviderBaseUrl(baseUrl) || baseUrl).hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export function providerToDraft(id: string, raw: unknown): CustomProviderDraft {
  const o = asRecord(raw) ?? {};
  const compat = asRecord(o.compat) ?? {};
  const baseUrl = typeof o.baseUrl === "string" ? o.baseUrl : "";
  const modelsRaw = Array.isArray(o.models) ? o.models : [];
  const models: CustomModelEntry[] = [];
  for (const item of modelsRaw) {
    const m = parseModelEntry(item);
    if (m) models.push(m);
  }
  if (!models.length) models.push({ id: "", name: "", reasoning: false });
  const localOff = defaultLocalCompatOff(baseUrl);
  return {
    id,
    name: typeof o.name === "string" ? o.name : "",
    baseUrl,
    api: parseApi(o.api),
    apiKey: typeof o.apiKey === "string" ? o.apiKey : "",
    supportsDeveloperRole:
      typeof compat.supportsDeveloperRole === "boolean"
        ? compat.supportsDeveloperRole
        : !localOff,
    supportsReasoningEffort:
      typeof compat.supportsReasoningEffort === "boolean"
        ? compat.supportsReasoningEffort
        : !localOff,
    models,
  };
}

/** Providers that look like custom / editable entries in models.json. */
export function listEditableProviders(doc: ModelsConfigDoc): CustomProviderDraft[] {
  const out: CustomProviderDraft[] = [];
  for (const [id, raw] of Object.entries(doc.providers)) {
    const o = asRecord(raw);
    if (!o) continue;
    const hasModels = Array.isArray(o.models);
    const hasBaseUrl = typeof o.baseUrl === "string" && o.baseUrl.trim().length > 0;
    if (!hasModels && !hasBaseUrl) continue;
    out.push(providerToDraft(id, o));
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function mergeModelJson(
  draft: CustomModelEntry,
  existing: Record<string, unknown> | null,
): Record<string, unknown> {
  const base: Record<string, unknown> = existing ? { ...existing } : {};
  base.id = draft.id.trim();
  if (draft.name.trim()) base.name = draft.name.trim();
  else delete base.name;

  if (draft.reasoning) base.reasoning = true;
  else delete base.reasoning;

  if (draft.contextWindow && draft.contextWindow > 0) {
    base.contextWindow = Math.floor(draft.contextWindow);
  } else if (!existing?.contextWindow) {
    delete base.contextWindow;
  }

  if (draft.maxTokens && draft.maxTokens > 0) {
    base.maxTokens = Math.floor(draft.maxTokens);
  } else if (!existing?.maxTokens) {
    delete base.maxTokens;
  }

  if (draft.vision) {
    base.input = ["text", "image"];
  } else if (Array.isArray(base.input)) {
    // Preserve non-image custom input arrays; strip image when vision off.
    const next = (base.input as unknown[]).filter((x) => x !== "image");
    base.input = next.length ? next : ["text"];
  }

  return base;
}

/**
 * Build provider JSON while merging unknown fields from `existing`
 * (headers, modelOverrides, cost, thinkingLevelMap, extra compat, …).
 */
export function draftToProviderJson(
  draft: CustomProviderDraft,
  existing?: unknown,
  opts?: { omitApiKey?: boolean },
): Record<string, unknown> {
  const prev = asRecord(existing) ?? {};
  const prevModels = Array.isArray(prev.models) ? prev.models : [];
  const prevById = new Map<string, Record<string, unknown>>();
  for (const item of prevModels) {
    const o = asRecord(item);
    if (!o || typeof o.id !== "string") continue;
    prevById.set(o.id, o);
  }

  const models = draft.models
    .map((m) => {
      const id = m.id.trim();
      if (!id) return null;
      return mergeModelJson(m, prevById.get(id) ?? null);
    })
    .filter((m): m is Record<string, unknown> => Boolean(m));

  const out: Record<string, unknown> = { ...prev };
  out.baseUrl = normalizeProviderBaseUrl(draft.baseUrl);
  out.api = draft.api;
  out.models = models;

  if (draft.name.trim()) out.name = draft.name.trim();
  else delete out.name;

  const inlineKey = shouldStoreApiKeyInModelsJson(draft.apiKey, draft.baseUrl);
  if (opts?.omitApiKey) {
    delete out.apiKey;
  } else if (inlineKey) {
    out.apiKey = draft.apiKey.trim();
  } else if (!draft.apiKey.trim()) {
    // Keep existing models.json key (e.g. $ENV) if user cleared the UI field.
    // If there was none, leave omitted (auth.json can supply it).
  } else {
    // Remote secret → auth.json; remove plaintext from models.json if present.
    delete out.apiKey;
  }

  const prevCompat = asRecord(prev.compat) ?? {};
  const compat: Record<string, unknown> = { ...prevCompat };
  if (draft.supportsDeveloperRole) delete compat.supportsDeveloperRole;
  else compat.supportsDeveloperRole = false;
  if (draft.supportsReasoningEffort) delete compat.supportsReasoningEffort;
  else compat.supportsReasoningEffort = false;
  if (Object.keys(compat).length) out.compat = compat;
  else delete out.compat;

  return out;
}

export function validateCustomProvider(
  draft: CustomProviderDraft,
  opts?: { editingId?: string | null; existingIds?: string[] },
): string | null {
  const id = draft.id.trim();
  if (!id) return "Provider ID is required";
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)) {
    return "Provider ID must start with a letter and use only letters, numbers, _ or -";
  }
  if (!draft.baseUrl.trim()) return "Base URL is required";
  try {
    // eslint-disable-next-line no-new
    new URL(normalizeProviderBaseUrl(draft.baseUrl) || draft.baseUrl.trim());
  } catch {
    return "Base URL is invalid";
  }
  if (!(CUSTOM_MODEL_APIS as readonly string[]).includes(draft.api)) {
    return "API type is invalid";
  }
  const modelIds = draft.models.map((m) => m.id.trim()).filter(Boolean);
  if (!modelIds.length) return "Add at least one model id";
  if (new Set(modelIds).size !== modelIds.length) return "Duplicate model ids";

  const existing = opts?.existingIds ?? [];
  const editing = opts?.editingId?.trim() || null;
  if (existing.includes(id) && id !== editing) {
    return `Provider “${id}” already exists`;
  }
  return null;
}

export function upsertCustomProvider(doc: ModelsConfigDoc, draft: CustomProviderDraft): ModelsConfigDoc {
  const id = draft.id.trim();
  const next = { providers: { ...doc.providers }, rest: { ...doc.rest } };
  next.providers[id] = draftToProviderJson(draft, doc.providers[id]);
  return next;
}

export function removeCustomProvider(doc: ModelsConfigDoc, id: string): ModelsConfigDoc {
  const next = { providers: { ...doc.providers }, rest: { ...doc.rest } };
  delete next.providers[id];
  return next;
}

export function renameCustomProvider(
  doc: ModelsConfigDoc,
  fromId: string,
  draft: CustomProviderDraft,
): ModelsConfigDoc {
  const next = { providers: { ...doc.providers }, rest: { ...doc.rest } };
  const existing = fromId ? next.providers[fromId] : next.providers[draft.id.trim()];
  if (fromId && fromId !== draft.id.trim()) {
    delete next.providers[fromId];
  }
  next.providers[draft.id.trim()] = draftToProviderJson(draft, existing);
  return next;
}

/** Merge discovered models into draft rows (upsert by id, keep manual fields). */
export function mergeDiscoveredIntoDraft(
  current: CustomModelEntry[],
  discovered: Array<{
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
  }>,
): CustomModelEntry[] {
  const byId = new Map<string, CustomModelEntry>();
  for (const m of current) {
    const id = m.id.trim();
    if (id) byId.set(id, { ...m, id });
  }
  for (const d of discovered) {
    const id = d.id.trim();
    if (!id) continue;
    const prev = byId.get(id);
    byId.set(id, {
      id,
      name: prev?.name || d.name || "",
      reasoning: prev?.reasoning ?? false,
      vision: prev?.vision,
      contextWindow: d.contextWindow ?? prev?.contextWindow,
      maxTokens: d.maxTokens ?? prev?.maxTokens,
    });
  }
  const list = [...byId.values()];
  return list.length ? list : [{ id: "", name: "", reasoning: false }];
}

/** Helpers for GUI editing of ~/.pi/agent/models.json custom providers. */

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
};

export type CustomProviderDraft = {
  /** Provider key in models.json */
  id: string;
  name: string;
  baseUrl: string;
  api: CustomModelApi;
  /** Stored in models.json (placeholder OK for local servers). */
  apiKey: string;
  supportsDeveloperRole: boolean;
  supportsReasoningEffort: boolean;
  models: CustomModelEntry[];
};

export type ModelsConfigDoc = {
  providers: Record<string, unknown>;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function emptyCustomProvider(partial?: Partial<CustomProviderDraft>): CustomProviderDraft {
  return {
    id: "",
    name: "",
    baseUrl: "http://localhost:11434/v1",
    api: "openai-completions",
    apiKey: "ollama",
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
  return { providers: { ...providers } };
}

export function stringifyModelsConfig(doc: ModelsConfigDoc): string {
  return `${JSON.stringify({ providers: doc.providers }, null, 2)}\n`;
}

function parseApi(v: unknown): CustomModelApi {
  if (typeof v === "string" && (CUSTOM_MODEL_APIS as readonly string[]).includes(v)) {
    return v as CustomModelApi;
  }
  return "openai-completions";
}

function parseModelEntry(raw: unknown): CustomModelEntry | null {
  const o = asRecord(raw);
  if (!o) return null;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  if (!id) return null;
  return {
    id,
    name: typeof o.name === "string" ? o.name : "",
    reasoning: o.reasoning === true,
  };
}

export function providerToDraft(id: string, raw: unknown): CustomProviderDraft {
  const o = asRecord(raw) ?? {};
  const compat = asRecord(o.compat) ?? {};
  const modelsRaw = Array.isArray(o.models) ? o.models : [];
  const models: CustomModelEntry[] = [];
  for (const item of modelsRaw) {
    const m = parseModelEntry(item);
    if (m) models.push(m);
  }
  if (!models.length) models.push({ id: "", name: "", reasoning: false });
  return {
    id,
    name: typeof o.name === "string" ? o.name : "",
    baseUrl: typeof o.baseUrl === "string" ? o.baseUrl : "",
    api: parseApi(o.api),
    apiKey: typeof o.apiKey === "string" ? o.apiKey : "",
    supportsDeveloperRole: compat.supportsDeveloperRole === true,
    supportsReasoningEffort: compat.supportsReasoningEffort === true,
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

export function draftToProviderJson(draft: CustomProviderDraft): Record<string, unknown> {
  const models = draft.models
    .map((m) => ({
      id: m.id.trim(),
      ...(m.name.trim() ? { name: m.name.trim() } : {}),
      ...(m.reasoning ? { reasoning: true } : {}),
    }))
    .filter((m) => m.id);

  const out: Record<string, unknown> = {
    baseUrl: draft.baseUrl.trim(),
    api: draft.api,
    models,
  };
  if (draft.name.trim()) out.name = draft.name.trim();
  if (draft.apiKey.trim()) out.apiKey = draft.apiKey.trim();

  const compat: Record<string, boolean> = {};
  // Local OpenAI-compatible servers usually need these false.
  if (!draft.supportsDeveloperRole) compat.supportsDeveloperRole = false;
  if (!draft.supportsReasoningEffort) compat.supportsReasoningEffort = false;
  if (Object.keys(compat).length) out.compat = compat;

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
    new URL(draft.baseUrl.trim());
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
  const next = { providers: { ...doc.providers } };
  // If renaming (shouldn't happen when id locked), delete old — caller passes editingId separately.
  next.providers[id] = draftToProviderJson(draft);
  return next;
}

export function removeCustomProvider(doc: ModelsConfigDoc, id: string): ModelsConfigDoc {
  const next = { providers: { ...doc.providers } };
  delete next.providers[id];
  return next;
}

export function renameCustomProvider(
  doc: ModelsConfigDoc,
  fromId: string,
  draft: CustomProviderDraft,
): ModelsConfigDoc {
  const next = { providers: { ...doc.providers } };
  if (fromId && fromId !== draft.id.trim()) {
    delete next.providers[fromId];
  }
  next.providers[draft.id.trim()] = draftToProviderJson(draft);
  return next;
}

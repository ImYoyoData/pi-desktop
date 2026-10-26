/** Helpers for GUI editing of ~/.pi/agent/models.json custom providers (Pi-aligned). */

import { normalizeProviderBaseUrl } from "./model-discover";
import {
  DEFAULT_MAX_TOKENS,
  inferModelCapabilities,
  resolveContextWindow,
} from "./model-metadata";
import { THINKING_LEVELS, availableThinkingLevels, type ThinkingLevel } from "./thinking-level";

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
  /** Optional — defaults to the GUI budget (32768) when omitted */
  maxTokens?: number;
  /** When true, model accepts images (`input: ["text","image"]`). */
  vision?: boolean;
  /**
   * 可用思考档位（写回 models.json 的 thinkingLevelMap，未勾选记 null）。
   * undefined 表示文件里没配过，UI 视为全档位可用。
   */
  thinkingLevels?: ThinkingLevel[];
};

/** A fresh, blank model row. Max output defaults to the GUI budget. */
export function newModelEntry(partial?: Partial<CustomModelEntry>): CustomModelEntry {
  return {
    id: "",
    name: "",
    reasoning: false,
    maxTokens: DEFAULT_MAX_TOKENS,
    ...partial,
  };
}

export type CustomProviderDraft = {
  /** Provider key in models.json */
  id: string;
  name: string;
  baseUrl: string;
  /** providers.<id>.api；未知取值原样保留（如分类器的 system-one api）。 */
  api: string;
  /**
   * UI field for the API key. Written to `providers.<id>.apiKey` in models.json.
   */
  apiKey: string;
  supportsDeveloperRole: boolean;
  supportsReasoningEffort: boolean;
  /** classifier 图像输入方式（pi compat.imageInput）；auto 表示不写该键。 */
  imageInput: CustomImageInput;
  /** classifier 是否带 TypeSafe 图像 opt-in 头；true 表示不写该键（走 pi 默认）。 */
  imageOptInHeader: boolean;
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
    imageInput: "auto",
    imageOptInHeader: true,
    models: [newModelEntry()],
    ...partial,
  };
}

export function parseModelsConfigText(text: string): ModelsConfigDoc {
  let parsed: unknown = { providers: {} };
  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(
        `Invalid models.json: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const root = asRecord(parsed) ?? {};
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

/** 保留 models.json 里的 api 原值，只给缺失值兜底，避免改写分类器等非对话 api。 */
function parseApi(v: unknown): string {
  return typeof v === "string" && v.trim() ? v.trim() : "openai-completions";
}

/** pi compat.imageInput 的已支持取值；auto 表示不写该键。 */
export const CUSTOM_IMAGE_INPUTS = [
  "auto",
  "assets",
  "images",
  "state-image-urls",
] as const;

export type CustomImageInput = (typeof CUSTOM_IMAGE_INPUTS)[number];

function parseImageInput(v: unknown): CustomImageInput {
  return typeof v === "string" && (CUSTOM_IMAGE_INPUTS as readonly string[]).includes(v)
    ? (v as CustomImageInput)
    : "auto";
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

/** thinkingLevelMap 里显式 null 的档位不可用；缺失键保持桌面端全档位开放的行为。 */
function parseThinkingLevels(map: unknown): ThinkingLevel[] | undefined {
  return availableThinkingLevels(map);
}

function parseModelEntry(raw: unknown): CustomModelEntry | null {
  const o = asRecord(raw);
  if (!o) return null;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  if (!id) return null;
  const contextWindow = parsePositiveInt(o.contextWindow);
  const maxTokens = parsePositiveInt(o.maxTokens);
  const thinkingLevels = parseThinkingLevels(o.thinkingLevelMap);
  return {
    id,
    name: typeof o.name === "string" ? o.name : "",
    reasoning: o.reasoning === true,
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxTokens ? { maxTokens } : {}),
    ...(modelHasVision(o.input) ? { vision: true } : {}),
    ...(thinkingLevels ? { thinkingLevels } : {}),
  };
}

/**
 * compat 里这两个开关缺键时 pi 按地址自动判断：本地服务当作不支持。
 * 写入必须与这个默认值同源，否则「打开开关 = 删键」读回来又变回关闭。
 */
function writeCompatFlag(
  compat: Record<string, unknown>,
  key: "supportsDeveloperRole" | "supportsReasoningEffort",
  value: boolean,
  defaultValue: boolean,
): void {
  if (value === defaultValue) delete compat[key];
  else compat[key] = value;
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
  if (!models.length) models.push(newModelEntry());
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
    imageInput: parseImageInput(compat.imageInput),
    imageOptInHeader: compat.sendImageOptInHeader !== false,
    models,
  };
}

/** Providers that look like custom / editable entries in models.json，顺序即文件中的键序。 */
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
  return out;
}

/** 按给定 id 顺序重写 providers；未列在 orderedIds 里的条目保持原相对顺序，追加在尾部。 */
export function reorderProviders(
  doc: ModelsConfigDoc,
  orderedIds: string[],
): ModelsConfigDoc {
  const providers: Record<string, unknown> = {};
  for (const id of orderedIds) {
    if (id in doc.providers) providers[id] = doc.providers[id];
  }
  for (const [id, value] of Object.entries(doc.providers)) {
    if (!(id in providers)) providers[id] = value;
  }
  return { providers, rest: { ...doc.rest } };
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

  mergeThinkingLevels(base, draft, existing);

  return base;
}

/**
 * 把勾选的档位写成 thinkingLevelMap：未勾选记 null（pi 视为不可用），已勾选保留原有映射值。
 * 未配置或「全选且原本没有映射」时不动该键，避免给默认配置写上冗余字段。
 */
function mergeThinkingLevels(
  base: Record<string, unknown>,
  draft: CustomModelEntry,
  existing: Record<string, unknown> | null,
): void {
  const selected = draft.thinkingLevels;
  if (!selected) return;
  const prevMap = asRecord(existing?.thinkingLevelMap);
  const allSelected = selected.length === THINKING_LEVELS.length;
  if (allSelected && !prevMap) return;
  const map: Record<string, string | null> = {};
  for (const { value: level } of THINKING_LEVELS) {
    if (!selected.includes(level)) {
      map[level] = null;
      continue;
    }
    const prevValue = prevMap?.[level];
    map[level] = typeof prevValue === "string" ? prevValue : level;
  }
  base.thinkingLevelMap = map;
}

/**
 * Build provider JSON while merging unknown fields from `existing`
 * (headers, modelOverrides, cost, thinkingLevelMap, extra compat, …).
 */
export function draftToProviderJson(
  draft: CustomProviderDraft,
  existing?: unknown,
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

  if (draft.apiKey.trim()) out.apiKey = draft.apiKey.trim();
  else delete out.apiKey;

  const prevCompat = asRecord(prev.compat) ?? {};
  const compat: Record<string, unknown> = { ...prevCompat };
  const compatDefault = !defaultLocalCompatOff(draft.baseUrl);
  writeCompatFlag(compat, "supportsDeveloperRole", draft.supportsDeveloperRole, compatDefault);
  writeCompatFlag(
    compat,
    "supportsReasoningEffort",
    draft.supportsReasoningEffort,
    compatDefault,
  );
  if (draft.imageInput === "auto") delete compat.imageInput;
  else compat.imageInput = draft.imageInput;
  if (draft.imageOptInHeader) delete compat.sendImageOptInHeader;
  else compat.sendImageOptInHeader = false;
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
  if (!draft.api.trim()) {
    return "API type is required";
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
  const targetId = draft.id.trim();
  const existing = fromId ? doc.providers[fromId] : doc.providers[targetId];
  const json = draftToProviderJson(draft, existing);
  // 重建对象以保留重命名前的排序位置，避免条目被挤到末尾。
  const providers: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(doc.providers)) {
    if (id === fromId) providers[targetId] = json;
    else if (id !== targetId) providers[id] = value;
  }
  if (!(targetId in providers)) providers[targetId] = json;
  return { providers, rest: { ...doc.rest } };
}

/** A model row parsed from pasted text. */
export type BulkModelToken = { id: string; name: string };

/**
 * Parse pasted model ids for the bulk-add dialog.
 *
 * Chunks are split on newlines / commas / semicolons first, so the
 * `ID=Display name` form survives spaces in the display name; only chunks
 * *without* `=` are further split on whitespace (so `a b c` yields three ids).
 * Duplicates are dropped, first occurrence wins.
 */
export function parseBulkModelTokens(text: string): BulkModelToken[] {
  const out: BulkModelToken[] = [];
  const seen = new Set<string>();
  const push = (id: string, name: string): void => {
    const cleanId = id.trim();
    if (!cleanId || seen.has(cleanId)) return;
    seen.add(cleanId);
    out.push({ id: cleanId, name: name.trim() });
  };
  for (const chunk of text.split(/[\n\r,;]+/u)) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      push(trimmed.slice(0, eq), trimmed.slice(eq + 1));
      continue;
    }
    for (const token of trimmed.split(/\s+/u)) push(token, "");
  }
  return out;
}

/**
 * Merge discovered models into draft rows (upsert by id, keep manual fields).
 *
 * Discovery rarely reports a max-output budget, so every merged row gets the GUI
 * default ({@link DEFAULT_MAX_TOKENS}); the context window falls back to the
 * family heuristic before staying empty.
 *
 * Capabilities (`reasoning` / `vision`) always resolve through
 * {@link inferModelCapabilities}: a provider that reports them wins, otherwise
 * the model id is classified — so the form never asks the user to tick boxes.
 */
export function mergeDiscoveredIntoDraft(
  current: CustomModelEntry[],
  discovered: Array<{
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    reasoning?: boolean;
    vision?: boolean;
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
    // A row the user already has keeps the capabilities it was saved with.
    const caps = inferModelCapabilities(id, {
      reasoning: d.reasoning ?? prev?.reasoning,
      vision: d.vision ?? prev?.vision,
    });
    byId.set(id, {
      id,
      name: prev?.name || d.name || "",
      reasoning: caps.reasoning,
      vision: caps.vision,
      contextWindow: resolveContextWindow(d.contextWindow ?? prev?.contextWindow, id),
      maxTokens: d.maxTokens ?? prev?.maxTokens ?? DEFAULT_MAX_TOKENS,
    });
  }
  const list = [...byId.values()];
  return list.length ? list : [newModelEntry()];
}

/** Per-model overrides for a built-in (Pi SDK) provider. */
export type ProviderModelOverride = {
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  vision?: boolean;
};

/**
 * Upsert `providers.<providerId>.modelOverrides` — the Pi-supported way to pin
 * limits on built-in models: pricing and everything else stay intact.
 */
export function applyProviderModelOverrides(
  doc: ModelsConfigDoc,
  providerId: string,
  overrides: Record<string, ProviderModelOverride>,
): ModelsConfigDoc {
  const id = providerId.trim();
  const next: ModelsConfigDoc = { providers: { ...doc.providers }, rest: { ...doc.rest } };
  const prev = asRecord(next.providers[id]) ?? {};
  const prevOverrides = asRecord(prev.modelOverrides) ?? {};
  const merged: Record<string, unknown> = { ...prevOverrides };
  for (const [modelId, value] of Object.entries(overrides)) {
    const key = modelId.trim();
    if (!key) continue;
    const entry: Record<string, unknown> = { ...(asRecord(merged[key]) ?? {}) };
    if (value.name?.trim()) entry.name = value.name.trim();
    if (value.contextWindow && value.contextWindow > 0) {
      entry.contextWindow = Math.floor(value.contextWindow);
    }
    if (value.maxTokens && value.maxTokens > 0) {
      entry.maxTokens = Math.floor(value.maxTokens);
    }
    if (typeof value.reasoning === "boolean") entry.reasoning = value.reasoning;
    if (value.vision) entry.input = ["text", "image"];
    merged[key] = entry;
  }
  next.providers[id] = { ...prev, modelOverrides: merged };
  return next;
}

/** Existing `modelOverrides` entries for a provider (id → override object). */
export function listProviderModelOverrides(
  doc: ModelsConfigDoc,
  providerId: string,
): Record<string, Record<string, unknown>> {
  const provider = asRecord(doc.providers[providerId.trim()]);
  const overrides = asRecord(provider?.modelOverrides);
  if (!overrides) return {};
  const out: Record<string, Record<string, unknown>> = {};
  for (const [id, value] of Object.entries(overrides)) {
    const o = asRecord(value);
    if (o) out[id] = o;
  }
  return out;
}

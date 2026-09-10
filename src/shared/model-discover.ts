/** Discover models from OpenAI-compatible (and common local) endpoints. */

export type DiscoveredModel = {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  /** Endpoint advertises image input. */
  vision?: boolean;
  /** Endpoint advertises extended thinking. */
  reasoning?: boolean;
};

export type DiscoverModelsInput = {
  baseUrl: string;
  apiKey?: string;
  /** openai-completions | anthropic-messages | … — affects probe paths */
  api?: string;
};

export type DiscoverModelsResult =
  | { ok: true; models: DiscoveredModel[]; source: string }
  | { ok: false; error: string };

type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}>;

export type TestModelConnectionInput = {
  baseUrl: string;
  apiKey?: string;
  /** openai-completions | openai-responses | anthropic-messages | google-generative-ai */
  api?: string;
  modelId: string;
};

export type TestModelConnectionResult =
  | { ok: true; latencyMs: number; status: number }
  | { ok: false; error: string; latencyMs?: number; status?: number };

function trimSlash(url: string): string {
  return url.replace(/\/+$/u, "");
}

/** Strip accidental path suffixes users paste from docs. */
export function normalizeProviderBaseUrl(raw: string): string {
  let u = raw.trim();
  if (!u) return u;
  u = trimSlash(u);
  u = u.replace(/\/v1\/chat\/completions$/iu, "/v1");
  u = u.replace(/\/chat\/completions$/iu, "");
  u = u.replace(/\/v1\/messages$/iu, "");
  u = u.replace(/\/messages$/iu, "");
  return trimSlash(u);
}

function authHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = apiKey?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
  if (typeof v === "string" && /^\d+$/u.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  return undefined;
}

/** First positive number found among candidate fields (keeps the most specific provider hint). */
function firstNum(...candidates: unknown[]): number | undefined {
  for (const c of candidates) {
    const n = num(c);
    if (n) return n;
  }
  return undefined;
}

/** Context-window candidates across common OpenAI-compatible / vLLM / OpenRouter / Anthropic shapes. */
function modelContextWindow(o: Record<string, unknown>): number | undefined {
  const limits = asRecord(o.limits);
  const topProvider = asRecord(o.top_provider) ?? asRecord(o.topProvider);
  return firstNum(
    o.context_window,
    o.contextWindow,
    o.context_length,
    o.contextLength,
    o.max_context_window,
    o.maxContextWindow,
    o.max_model_len,
    o.maxModelLen,
    o.max_context_length,
    o.maxContextLength,
    o.input_token_limit,
    o.inputTokenLimit,
    o.max_input_tokens,
    o.maxInputTokens,
    o.tokens_limit,
    o.tokensLimit,
    limits?.context_window,
    limits?.max_context_length,
    limits?.max_input_tokens,
    topProvider?.context_length,
    topProvider?.context_window,
    asRecord(o.meta)?.context_window,
  );
}

/** Max-output candidates across common OpenAI-compatible / OpenRouter / Anthropic shapes. */
function modelMaxTokens(o: Record<string, unknown>): number | undefined {
  const limits = asRecord(o.limits);
  const topProvider = asRecord(o.top_provider) ?? asRecord(o.topProvider);
  return firstNum(
    o.max_tokens,
    o.maxTokens,
    o.max_output_tokens,
    o.maxOutputTokens,
    o.max_output,
    o.maxOutput,
    o.output_token_limit,
    o.outputTokenLimit,
    o.max_completion_tokens,
    o.maxCompletionTokens,
    o.default_max_tokens,
    o.defaultMaxTokens,
    limits?.max_tokens,
    limits?.max_output_tokens,
    limits?.max_completion_tokens,
    topProvider?.max_completion_tokens,
    topProvider?.max_output_tokens,
    asRecord(o.meta)?.max_tokens,
    asRecord(o.meta)?.max_output_tokens,
  );
}

/** Read a tri-state boolean, ignoring non-boolean junk. */
function boolOf(...values: unknown[]): boolean | undefined {
  for (const v of values) {
    if (typeof v === "boolean") return v;
  }
  return undefined;
}

/** True when any of the given arrays/lists mentions `needle`. */
function listsInclude(needle: string, ...values: unknown[]): boolean {
  return values.some((v) => Array.isArray(v) && v.some((x) => x === needle));
}

/**
 * Image-input hint from the endpoint payload, or undefined when the provider
 * says nothing (the id-based heuristic in `model-metadata` then decides).
 */
function modelSupportsVision(o: Record<string, unknown>): boolean | undefined {
  const architecture = asRecord(o.architecture);
  const capabilities = asRecord(o.capabilities);
  const explicit = boolOf(o.supports_vision, o.supportsVision, capabilities?.vision);
  if (explicit !== undefined) return explicit;
  if (
    listsInclude("image", o.input, o.modalities, o.input_modalities, architecture?.input_modalities)
  ) {
    return true;
  }
  // OpenRouter packs it into a string: "text+image->text".
  const modality = architecture?.modality ?? o.modality;
  return typeof modality === "string" ? modality.includes("image") : undefined;
}

/**
 * Extended-thinking hint from the endpoint payload, or undefined when silent.
 * Covers OpenRouter's `supported_parameters` as well as the common flags.
 */
function modelSupportsReasoning(o: Record<string, unknown>): boolean | undefined {
  const capabilities = asRecord(o.capabilities);
  const explicit = boolOf(o.reasoning, o.supports_reasoning, o.supportsReasoning, capabilities?.reasoning);
  if (explicit !== undefined) return explicit;
  if (
    listsInclude("reasoning", o.supported_parameters, o.supportedParameters) ||
    listsInclude("include_reasoning", o.supported_parameters) ||
    listsInclude("reasoning_effort", o.supported_parameters)
  ) {
    return true;
  }
  // `thinking: {...}` (Anthropic-style) or `{ type: "enabled" }`.
  const thinking = o.thinking;
  if (thinking === true) return true;
  const thinkingRecord = asRecord(thinking);
  if (thinkingRecord && (thinkingRecord.type === "enabled" || thinkingRecord.type === "adaptive")) {
    return true;
  }
  return undefined;
}


function parseOpenAiModelsPayload(payload: unknown): DiscoveredModel[] {
  const root = asRecord(payload);
  const data = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.data)
      ? root!.data
      : Array.isArray(root?.models)
        ? root!.models
        : null;
  if (!data) return [];
  const out: DiscoveredModel[] = [];
  for (const item of data) {
    const o = asRecord(item);
    if (!o) continue;
    const id = typeof o.id === "string" ? o.id.trim() : typeof o.name === "string" ? o.name.trim() : "";
    if (!id) continue;
    const contextWindow = modelContextWindow(o);
    const maxTokens = modelMaxTokens(o);
    const vision = modelSupportsVision(o);
    const reasoning = modelSupportsReasoning(o);
    out.push({
      id,
      name: typeof o.name === "string" && o.name !== id ? o.name : undefined,
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {}),
      ...(vision !== undefined ? { vision } : {}),
      ...(reasoning !== undefined ? { reasoning } : {}),
    });
  }
  return out;
}

function parseOllamaTagsPayload(payload: unknown): DiscoveredModel[] {
  const root = asRecord(payload);
  const models = Array.isArray(root?.models) ? root!.models : null;
  if (!models) return [];
  const out: DiscoveredModel[] = [];
  for (const item of models) {
    const o = asRecord(item);
    if (!o) continue;
    const id = typeof o.name === "string" ? o.name.trim() : typeof o.model === "string" ? o.model.trim() : "";
    if (!id) continue;
    const details = asRecord(o.details);
    const contextWindow = num(details?.context_length) ?? num(o.context_window);
    out.push({
      id,
      ...(contextWindow ? { contextWindow } : {}),
    });
  }
  return out;
}

async function getJson(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetchImpl(url, { method: "GET", headers, signal });
    const text = await res.text();
    if (!res.ok) {
      const snippet = text.replace(/\s+/gu, " ").slice(0, 180);
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}${snippet ? `: ${snippet}` : ""}` };
    }
    if (!text.trim()) return { ok: true, json: {} };
    try {
      return { ok: true, json: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, error: "Response is not JSON" };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Probe OpenAI `GET {base}/models`, then Ollama `GET {origin}/api/tags` for local servers.
 */
export async function discoverModels(
  input: DiscoverModelsInput,
  opts?: { fetchImpl?: FetchLike; signal?: AbortSignal },
): Promise<DiscoverModelsResult> {
  const baseUrl = normalizeProviderBaseUrl(input.baseUrl);
  if (!baseUrl) return { ok: false, error: "Base URL is required" };
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { ok: false, error: "Base URL is invalid" };
  }

  const fetchImpl = opts?.fetchImpl ?? (globalThis.fetch as FetchLike);
  const headers = authHeaders(input.apiKey);
  const errors: string[] = [];

  const openAiUrl = `${baseUrl}/models`;
  const openAi = await getJson(fetchImpl, openAiUrl, headers, opts?.signal);
  if (openAi.ok) {
    const models = parseOpenAiModelsPayload(openAi.json);
    if (models.length) return { ok: true, models, source: openAiUrl };
    errors.push(`${openAiUrl}: empty model list`);
  } else {
    errors.push(`${openAiUrl}: ${openAi.error}`);
  }

  // Ollama native tags (base often …/v1 — try host root)
  const origin = `${parsed.protocol}//${parsed.host}`;
  if (origin !== baseUrl) {
    const tagsUrl = `${origin}/api/tags`;
    const tags = await getJson(fetchImpl, tagsUrl, { Accept: "application/json" }, opts?.signal);
    if (tags.ok) {
      const models = parseOllamaTagsPayload(tags.json);
      if (models.length) return { ok: true, models, source: tagsUrl };
      errors.push(`${tagsUrl}: empty model list`);
    } else {
      errors.push(`${tagsUrl}: ${tags.error}`);
    }
  }

  return {
    ok: false,
    error: `Could not fetch models.\n${errors.join("\n")}`,
  };
}

function defaultTestSignal(signal?: AbortSignal): AbortSignal | undefined {
  if (signal) return signal;
  const AbortSignalCtor = globalThis.AbortSignal as
    | (typeof AbortSignal & { timeout?: (ms: number) => AbortSignal })
    | undefined;
  if (AbortSignalCtor && typeof AbortSignalCtor.timeout === "function") {
    return AbortSignalCtor.timeout(20_000);
  }
  return undefined;
}

/**
 * Cheap connectivity / latency probe: one tiny completion (max 1 token).
 * Does not persist anything — only checks that the endpoint accepts the model.
 */
export async function testModelConnection(
  input: TestModelConnectionInput,
  opts?: { fetchImpl?: FetchLike; signal?: AbortSignal },
): Promise<TestModelConnectionResult> {
  const baseUrl = normalizeProviderBaseUrl(input.baseUrl);
  const modelId = input.modelId.trim();
  if (!baseUrl) return { ok: false, error: "Base URL is required" };
  if (!modelId) return { ok: false, error: "Model ID is required" };

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { ok: false, error: "Base URL is invalid" };
  }
  void parsed;

  const api = (input.api ?? "openai-completions").trim();
  const key = input.apiKey?.trim() ?? "";
  const fetchImpl = opts?.fetchImpl ?? (globalThis.fetch as FetchLike);
  const signal = defaultTestSignal(opts?.signal);
  const started = Date.now();

  let url: string;
  let headers: Record<string, string>;
  let body: string;

  if (api === "anthropic-messages") {
    url = `${baseUrl}/messages`;
    headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (key) {
      headers["x-api-key"] = key;
      headers.Authorization = `Bearer ${key}`;
    }
    body = JSON.stringify({
      model: modelId,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
  } else if (api === "google-generative-ai") {
    const qs = key ? `?key=${encodeURIComponent(key)}` : "";
    url = `${baseUrl}/models/${encodeURIComponent(modelId)}:generateContent${qs}`;
    headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    body = JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "ping" }] }],
      generationConfig: { maxOutputTokens: 1 },
    });
  } else if (api === "openai-responses") {
    url = `${baseUrl}/responses`;
    headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders(key),
    };
    body = JSON.stringify({
      model: modelId,
      input: "ping",
      max_output_tokens: 1,
    });
  } else {
    // openai-completions and unknown → chat completions
    url = `${baseUrl}/chat/completions`;
    headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders(key),
    };
    body = JSON.stringify({
      model: modelId,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      stream: false,
    });
  }

  try {
    const res = await fetchImpl(url, { method: "POST", headers, body, signal });
    const latencyMs = Date.now() - started;
    const text = await res.text();
    if (!res.ok) {
      const snippet = text.replace(/\s+/gu, " ").slice(0, 180);
      return {
        ok: false,
        error: `HTTP ${res.status} ${res.statusText}${snippet ? `: ${snippet}` : ""}`,
        latencyMs,
        status: res.status,
      };
    }
    return { ok: true, latencyMs, status: res.status };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started,
    };
  }
}

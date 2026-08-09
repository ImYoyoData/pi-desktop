/** Discover models from OpenAI-compatible (and common local) endpoints. */

export type DiscoveredModel = {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
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
    const contextWindow =
      num(o.context_window) ??
      num(o.contextWindow) ??
      num(o.max_model_len) ??
      num(asRecord(o.meta)?.context_window);
    const maxTokens = num(o.max_tokens) ?? num(o.maxTokens) ?? num(o.max_output_tokens);
    out.push({
      id,
      name: typeof o.name === "string" && o.name !== id ? o.name : undefined,
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {}),
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

import { ipcMain, type WebContents } from "electron";

import { IpcChannels } from "../shared/protocol";
import type {
  ModelsGetResult,
  ModelsOAuthEvent,
  ModelsOAuthEventPayload,
  ModelsOAuthPrompt,
  ModelsOAuthPromptReply,
  ModelsProviderAuth,
  ModelsQuotaResult,
  ModelsSetPayload,
  ProviderCatalogResult,
} from "../shared/models-settings";
import {
	discoverModels,
	testModelConnection,
	testProviderBaseUrl,
	type DiscoverModelsResult,
	type TestModelConnectionResult,
	type TestProviderBaseUrlResult,
} from "../shared/model-discover";
import type { SessionBroker } from "./session-broker";
import { getModelsConfigService } from "./models-config";
import { netFetch } from "./net-fetch";
import { buildCatalogIndex, enrichDiscoveredModels, resolveDiscoveredModels } from "./model-catalog";
import { readModelSelection, writeModelSelection } from "./models-selection";
import type { ModelSelection } from "../shared/model-selection";
import type { AuthEvent, AuthInteraction, AuthPrompt } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

async function createRuntime(): Promise<import("@earendil-works/pi-coding-agent").ModelRuntime> {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const { paths } = getModelsConfigService();
  return ModelRuntime.create({
    modelsPath: paths.modelsPath,
    authPath: paths.authPath,
  });
}

/**
 * Sign in with ChatGPT 要求以稳定设备 ID 标识安装（写入全局 settings.json），
 * 与 pi CLI 的 login 行为一致。
 */
async function createDeviceIdProvider(): Promise<() => string> {
  const { SettingsManager, getAgentDir } = await import("@earendil-works/pi-coding-agent");
  const settingsManager = SettingsManager.create(process.cwd(), getAgentDir());
  return () => settingsManager.getOrCreateDeviceId();
}

/**
 * The API key stored in auth.json for a provider, if any.
 *
 * The custom-model form keeps its key in `models.json`, but a provider can also
 * be keyed through Settings → Providers (or OAuth), where the secret only ever
 * lands in auth.json. Endpoint probes have to consider both, or they hit 401 on
 * exactly the providers the user already configured.
 */
async function readStoredProviderKey(providerId: string | undefined): Promise<string | undefined> {
  const id = typeof providerId === "string" ? providerId.trim() : "";
  if (!id) return undefined;
  try {
    const cred = (await getModelsConfigService().readAuthConfig())[id];
    if (cred && cred.type === "api_key" && typeof cred.key === "string" && cred.key.trim()) {
      return cred.key.trim();
    }
  } catch {
    // Unreadable auth.json is not fatal — probe without a key.
  }
  return undefined;
}

/** Endpoint probes need a deadline; without one a hung server spins the button forever. */
function probeSignal(timeoutMs: number): AbortSignal | undefined {
  const ctor = globalThis.AbortSignal as
    | (typeof AbortSignal & { timeout?: (ms: number) => AbortSignal })
    | undefined;
  if (ctor && typeof ctor.timeout === "function") return ctor.timeout(timeoutMs);
  return undefined;
}

/** Form key wins; fall back to auth.json so a keyed provider still probes. */
async function resolveProbeKey(
  rawApiKey: unknown,
  rawProviderId: unknown,
): Promise<string | undefined> {
  const key = typeof rawApiKey === "string" ? rawApiKey.trim() : "";
  if (key) return key;
  return readStoredProviderKey(typeof rawProviderId === "string" ? rawProviderId : undefined);
}

export async function listAvailableModels(runtime: ModelRuntime): Promise<ModelsGetResult["available"]> {
  const models = await runtime.getAvailable();
  return models
    .map((m) => ({
      provider: m.provider,
      id: m.id,
      name: m.name ?? m.id,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      input: m.input,
      reasoning: m.reasoning,
      cost: m.cost,
    }))
    .sort((a, b) => {
      const byProvider = a.provider.localeCompare(b.provider);
      if (byProvider !== 0) return byProvider;
      return (a.name || a.id).localeCompare(b.name || b.id, undefined, { numeric: true });
    });
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

type StoredCredential = { type?: string; key?: string; access?: string; refresh?: string; expires?: number };

async function readStoredCredential(providerId: string): Promise<StoredCredential | undefined> {
  const cred = (await getModelsConfigService().readAuthConfig())[providerId] as
    | StoredCredential
    | undefined;
  return cred && typeof cred === "object" ? cred : undefined;
}

async function readProviderCredential(providerId: string): Promise<string | undefined> {
  const cred = await readStoredCredential(providerId);
  if (!cred) return undefined;
  if (cred.type === "oauth") return typeof cred.access === "string" ? cred.access : undefined;
  if (cred.type === "api_key") return typeof cred.key === "string" ? cred.key : undefined;
  return undefined;
}

const KIMI_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
const KIMI_OAUTH_HOST = "https://auth.kimi.com";

/**
 * Kimi Code 凭据过期时静默续期并回写 auth.json（与官方 Kimi Code CLI 的
 * 刷新参数一致），否则额度查询只会拿到 401。
 */
async function ensureKimiAccessToken(): Promise<string | undefined> {
  const cred = await readStoredCredential("kimi-coding");
  if (!cred || cred.type !== "oauth") return undefined;
  const access = typeof cred.access === "string" ? cred.access : undefined;
  const expiresAt = typeof cred.expires === "number" ? cred.expires : 0;
  if (access && expiresAt > Date.now() + 30_000) return access;
  const refreshToken = typeof cred.refresh === "string" ? cred.refresh : undefined;
  if (!refreshToken) return access;
  const response = await netFetch(`${KIMI_OAUTH_HOST}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: KIMI_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!response.ok) return access;
  const token = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (typeof token.access_token !== "string" || !token.access_token) return access;
  try {
    const service = getModelsConfigService();
    const auth = await service.readAuthConfig();
    await service.writeAuthConfig({
      ...auth,
      "kimi-coding": {
        ...auth["kimi-coding"],
        type: "oauth",
        access: token.access_token,
        refresh: typeof token.refresh_token === "string" ? token.refresh_token : refreshToken,
        expires: Date.now() + (typeof token.expires_in === "number" ? token.expires_in : 3600) * 1000,
      },
    });
  } catch (err) {
    console.warn("[quota] failed to persist refreshed Kimi token", err);
  }
  return token.access_token;
}

async function fetchOpenRouterQuota(providerId: string): Promise<ModelsQuotaResult> {
  const key = await readProviderCredential(providerId);
  if (!key) return { providerId, supported: false, error: "missing credential" };
  const response = await netFetch("https://openrouter.ai/api/v1/credits", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) return { providerId, supported: false, error: `HTTP ${response.status}` };
  const payload = (await response.json()) as {
    data?: { total_credits?: number; total_usage?: number };
  };
  const total = typeof payload.data?.total_credits === "number" ? payload.data.total_credits : undefined;
  const used = typeof payload.data?.total_usage === "number" ? payload.data.total_usage : undefined;
  if (total === undefined && used === undefined) {
    return { providerId, supported: false, error: "unexpected response" };
  }
  const remaining = total !== undefined && used !== undefined ? total - used : undefined;
  return {
    providerId,
    supported: true,
    ...(remaining !== undefined ? { remaining } : {}),
    ...(total !== undefined ? { total } : {}),
    ...(used !== undefined ? { used } : {}),
    label:
      remaining !== undefined
        ? `剩余 ${formatUsd(remaining)}${total !== undefined ? ` / ${formatUsd(total)}` : ""}`
        : `已用 ${formatUsd(used ?? 0)}`,
  };
}

type QuotaWindow = { used: number; limit: number; resetAt?: string };

function quotaWindowFrom(value: unknown): QuotaWindow | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { limit?: unknown; used?: unknown; remaining?: unknown; resetTime?: unknown; reset_at?: unknown };
  const limit = typeof record.limit === "number" ? record.limit : Number.NaN;
  if (!Number.isFinite(limit) || limit <= 0) return null;
  let used = typeof record.used === "number" ? record.used : Number.NaN;
  if (!Number.isFinite(used) && typeof record.remaining === "number") {
    used = limit - record.remaining;
  }
  if (!Number.isFinite(used)) return null;
  const resetRaw = record.resetTime ?? record.reset_at;
  return {
    used,
    limit,
    ...(typeof resetRaw === "string" && resetRaw ? { resetAt: resetRaw } : {}),
  };
}

function formatWindow(window: QuotaWindow): string {
  const percent = Math.max(0, Math.min(100, (window.used / window.limit) * 100));
  const suffix = window.resetAt ? `，${String(window.resetAt).slice(0, 10)} 重置` : "";
  return `已用 ${percent.toFixed(0)}%（${window.used} / ${window.limit}）${suffix}`;
}

/** Kimi Code 订阅用量（端点与官方 Kimi Code CLI 一致）。 */
async function fetchKimiQuota(providerId: string): Promise<ModelsQuotaResult> {
  const token = await ensureKimiAccessToken();
  if (!token) return { providerId, supported: false, error: "missing credential" };
  const response = await netFetch("https://api.kimi.com/coding/v1/usages", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) return { providerId, supported: false, error: `HTTP ${response.status}` };
  const body = (await response.json()) as Record<string, unknown>;
  const usage = quotaWindowFrom(body.usage);
  const limits = Array.isArray(body.limits) ? body.limits : [];
  const detail = quotaWindowFrom(
    (limits[0] as { detail?: unknown } | undefined)?.detail ?? limits[0],
  );
  const totalQuota = quotaWindowFrom(body.totalQuota);
  const windows = [usage, detail, totalQuota]
    .filter((w): w is QuotaWindow => w !== null)
    .map(formatWindow);
  const level =
    typeof (body.user as { membership?: { level?: unknown } } | undefined)?.membership?.level ===
    "string"
      ? (body.user as { membership: { level: string } }).membership.level
      : undefined;
  if (windows.length === 0) {
    return {
      providerId,
      supported: true,
      ...(level ? { plan: level } : {}),
      windows: [],
    };
  }
  return {
    providerId,
    supported: true,
    ...(level ? { plan: level } : {}),
    windows,
  };
}

/**
 * GitHub Copilot 订阅配额。`copilot_internal/user` 只接受 GitHub OAuth token，
 * auth.json 里存的是 Copilot 会话 token（tid=…）与它的 refresh（ghu_…），
 * 这里用后者查询。
 */
async function fetchCopilotQuota(providerId: string): Promise<ModelsQuotaResult> {
  const cred = await readStoredCredential(providerId);
  const githubToken =
    cred?.type === "oauth" && typeof cred.refresh === "string" && cred.refresh.startsWith("gh")
      ? cred.refresh
      : undefined;
  if (!githubToken) {
    return { providerId, supported: false, error: "missing GitHub OAuth token" };
  }
  const response = await netFetch("https://api.github.com/copilot_internal/user", {
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/json",
      "Editor-Version": "vscode/1.96.2",
      "Editor-Plugin-Version": "copilot-chat/0.26.7",
      "User-Agent": "GitHubCopilotChat/0.26.7",
      "X-Github-Api-Version": "2025-04-01",
    },
  });
  if (response.status === 401 || response.status === 403) {
    return { providerId, supported: false, error: `HTTP ${response.status}：凭据已失效，请重新登录` };
  }
  if (!response.ok) return { providerId, supported: false, error: `HTTP ${response.status}` };
  const body = (await response.json()) as {
    copilot_plan?: string;
    quota_reset_date?: string;
    quota_snapshots?: Record<string, { entitlement?: number; remaining?: number; percent_remaining?: number }>;
  };
  const plan = typeof body.copilot_plan === "string" && body.copilot_plan
    ? body.copilot_plan.charAt(0).toUpperCase() + body.copilot_plan.slice(1)
    : undefined;
  const resetLabel = typeof body.quota_reset_date === "string" && body.quota_reset_date
    ? body.quota_reset_date.slice(0, 10)
    : undefined;
  const snapshots = body.quota_snapshots ?? {};
  const windows: string[] = [];
  const describe = (
    name: string,
    snapshot: {
      entitlement?: number;
      remaining?: number;
      percent_remaining?: number;
      credits_used?: number;
    } | undefined,
  ) => {
    if (!snapshot) return;
    const entitlement = Number(snapshot.entitlement);
    const remaining = Number(snapshot.remaining);
    const percentRemaining = Number(snapshot.percent_remaining);
    const creditsUsed = Number(snapshot.credits_used);
    const usedPercent = Number.isFinite(percentRemaining)
      ? 100 - percentRemaining
      : Number.isFinite(entitlement) && entitlement > 0 && Number.isFinite(remaining)
        ? ((entitlement - remaining) / entitlement) * 100
        : Number.NaN;
    if (!Number.isFinite(usedPercent) || usedPercent <= 0) return;
    if (Number.isFinite(entitlement) && entitlement > 0) {
      // 超额时 remaining 为负数，截断会显示成「剩余 0」；改用 credits_used 呈现进度。
      const used = Number.isFinite(creditsUsed) && creditsUsed >= 0 ? creditsUsed : entitlement - remaining;
      windows.push(`${name} 已用 ${usedPercent.toFixed(0)}%（${used} / ${entitlement}）`);
      return;
    }
    if (Number.isFinite(creditsUsed) && creditsUsed > 0) {
      windows.push(`${name} 已用 ${creditsUsed}`);
    }
  };
  describe("高级请求", snapshots.premium_interactions);
  describe("对话", snapshots.chat);
  if (windows.length > 0 && resetLabel) {
    windows.push(`${resetLabel} 重置`);
  }
  return {
    providerId,
    supported: true,
    ...(plan ? { plan } : {}),
    windows,
  };
}

/** Grok（SuperGrok / X Premium）订阅周期用量。 */
async function fetchXaiQuota(providerId: string): Promise<ModelsQuotaResult> {
  const token = await readProviderCredential(providerId);
  if (!token) return { providerId, supported: false, error: "missing credential" };
  const response = await netFetch("https://cli-chat-proxy.grok.com/v1/billing", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) return { providerId, supported: false, error: `HTTP ${response.status}` };
  const body = (await response.json()) as {
    config?: {
      monthlyLimit?: { val?: number };
      used?: { val?: number };
      onDemandCap?: { val?: number };
      onDemandUsed?: { val?: number };
      billingPeriodEnd?: string;
      limits?: Record<string, { val?: number }>;
    };
  };
  const config = body.config;
  if (!config) return { providerId, supported: false, error: "unexpected response" };
  const windows: string[] = [];
  const monthlyLimit = config.monthlyLimit?.val ?? 0;
  const used = config.used?.val;
  if (monthlyLimit > 0 && typeof used === "number") {
    windows.push(formatWindow({ used, limit: monthlyLimit }));
  }
  const onDemandCap = config.onDemandCap?.val ?? 0;
  const onDemandUsed = config.onDemandUsed?.val;
  if (onDemandCap > 0 && typeof onDemandUsed === "number") {
    windows.push(formatWindow({ used: onDemandUsed, limit: onDemandCap }));
  }
  if (windows.length === 0) {
    // 无上限的包月订阅：只报已用量，不臆造总额度。
    if (typeof used === "number") {
      return {
        providerId,
        supported: true,
        used,
        windows: [`本周期已用 ${used}${config.billingPeriodEnd ? `，${config.billingPeriodEnd.slice(0, 10)} 重置` : ""}`],
      };
    }
    return { providerId, supported: false, error: "no usage data" };
  }
  return {
    providerId,
    supported: true,
    ...(typeof used === "number" ? { used } : {}),
    ...(monthlyLimit > 0 ? { total: monthlyLimit } : {}),
    windows,
  };
}

/**
 * 提供商额度查询。Pi SDK 自身没有额度 API，这里按各家官方客户端使用的公开
 * 端点查询（OpenRouter credits、Kimi Code usages、Grok billing）；未接管的
 * 提供商明确回 unsupported，不展示来路不明的数字。
 */
async function fetchProviderQuota(providerId: string): Promise<ModelsQuotaResult> {
  try {
    if (providerId === "openrouter") return await fetchOpenRouterQuota(providerId);
    if (providerId === "kimi-coding") return await fetchKimiQuota(providerId);
    if (providerId === "xai") return await fetchXaiQuota(providerId);
    if (providerId === "github-copilot") return await fetchCopilotQuota(providerId);
    return { providerId, supported: false };
  } catch (err) {
    return {
      providerId,
      supported: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Providers the desktop can authenticate: API key via auth.json, OAuth, or both.
 * Credentials-only providers (Bedrock, Vertex, …) expose no login path and are skipped.
 * `modelCount` is the number of **usable** models (`getAvailable`), not the catalog size.
 */
function listAuthProviders(
  runtime: ModelRuntime,
  available: ModelsGetResult["available"],
): ModelsProviderAuth[] {
  const availableCountByProvider = new Map<string, number>();
  for (const model of available) {
    availableCountByProvider.set(
      model.provider,
      (availableCountByProvider.get(model.provider) ?? 0) + 1,
    );
  }

  const seen = new Set<string>();
  const result: ModelsProviderAuth[] = [];

  for (const provider of runtime.getProviders()) {
    if (seen.has(provider.id)) continue;
    seen.add(provider.id);
    const supportsApiKey = Boolean(provider.auth?.apiKey?.login);
    const oauth = Boolean(provider.auth?.oauth);
    if (!supportsApiKey && !oauth) continue;
    const status = runtime.getProviderAuthStatus(provider.id);
    result.push({
      id: provider.id,
      displayName: provider.name || provider.id,
      configured: status.configured,
      source: status.source,
      modelCount: availableCountByProvider.get(provider.id) ?? 0,
      supportsApiKey,
      ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
      ...(oauth ? { oauth: true } : {}),
    });
  }

  result.sort((a, b) => {
    if (a.configured !== b.configured) return a.configured ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });
  return result;
}

type ActiveOauthLogin = {
  providerId: string;
  controller: AbortController;
  promptSeq: number;
  resolvePrompt: ((value: string) => void) | null;
  rejectPrompt: ((error: Error) => void) | null;
};

let activeOauthLogin: ActiveOauthLogin | null = null;

function toOauthEvent(event: AuthEvent): ModelsOAuthEvent {
  switch (event.type) {
    case "info":
      return {
        type: "info",
        message: event.message,
        ...(event.links ? { links: event.links.map((link) => ({ ...link })) } : {}),
      };
    case "auth_url":
      return {
        type: "auth_url",
        url: event.url,
        ...(event.instructions ? { instructions: event.instructions } : {}),
      };
    case "device_code":
      return {
        type: "device_code",
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        intervalSeconds: event.intervalSeconds,
        expiresInSeconds: event.expiresInSeconds,
      };
    case "progress":
      return { type: "progress", message: event.message };
  }
}

function pushOauthEvent(sender: WebContents, providerId: string, event: ModelsOAuthEvent): void {
  if (sender.isDestroyed()) return;
  const payload: ModelsOAuthEventPayload = { providerId, event };
  sender.send(IpcChannels.models.oauthEvent, payload);
}

function toOauthPrompt(prompt: AuthPrompt): ModelsOAuthPrompt {
  if (prompt.type === "select") {
    return {
      type: "select",
      message: prompt.message,
      options: prompt.options.map((option) => ({ ...option })),
    };
  }
  return { type: prompt.type, message: prompt.message, placeholder: prompt.placeholder };
}

/** Bridge one OAuth prompt to the renderer and wait for its reply. */
function requestOauthPrompt(
  session: ActiveOauthLogin,
  sender: WebContents,
  prompt: AuthPrompt,
): Promise<string> {
  const promptId = ++session.promptSeq;
  pushOauthEvent(sender, session.providerId, {
    type: "prompt",
    promptId,
    prompt: toOauthPrompt(prompt),
  });
  return new Promise<string>((resolve, reject) => {
    const clear = (): void => {
      session.resolvePrompt = null;
      session.rejectPrompt = null;
    };
    session.resolvePrompt = (value) => {
      clear();
      resolve(value);
    };
    session.rejectPrompt = (error) => {
      clear();
      reject(error);
    };
    prompt.signal?.addEventListener(
      "abort",
      () => session.rejectPrompt?.(new Error("登录已取消")),
      { once: true },
    );
  });
}

export function registerModelsIpc(broker: SessionBroker): void {
  ipcMain.handle(IpcChannels.models.get, async (): Promise<ModelsGetResult> => {
    const service = getModelsConfigService();
    const runtime = await createRuntime();
    // getAvailable() refreshes auth-gated availability; modelCount uses this, not catalog size
    const [modelsText, available] = await Promise.all([
      service.readModelsConfigText(),
      listAvailableModels(runtime),
    ]);
    const providers = listAuthProviders(runtime, available);
    const apiKeyConfigured = Object.fromEntries(providers.map((p) => [p.id, p.configured]));
    return {
      modelsText,
      apiKeyConfigured,
      providers,
      available,
      modelSelection: readModelSelection(),
    };
  });

  // Renderer-only curation: never touches models.json / auth.json.
  ipcMain.handle(IpcChannels.models.setSelection, async (_event, selection: ModelSelection) => {
    writeModelSelection(selection);
    await broker.notifyWorkersReloadModels();
  });

  ipcMain.handle(IpcChannels.models.fetchQuota, async (_event, rawProviderId: string) => {
    const providerId = String(rawProviderId ?? "").trim();
    if (!providerId) throw new Error("缺少提供商 ID");
    return fetchProviderQuota(providerId);
  });

  ipcMain.handle(IpcChannels.models.set, async (_event, payload: ModelsSetPayload) => {
    const service = getModelsConfigService();
    await service.writeModelsConfigText(payload.modelsText);
    if (payload.apiKeys) {
      for (const [provider, key] of Object.entries(payload.apiKeys)) {
        // Only write when user provided a non-empty key (empty = keep existing)
        if (key?.trim()) {
          await service.setProviderApiKey(provider, key.trim());
        }
      }
    }
    if (payload.clearAuth?.length) {
      const auth = await service.readAuthConfig();
      const next = { ...auth };
      let changed = false;
      for (const provider of payload.clearAuth) {
        const id = String(provider ?? "").trim();
        if (id && next[id] !== undefined) {
          delete next[id];
          changed = true;
        }
      }
      if (changed) await service.writeAuthConfig(next);
    }
    await broker.notifyWorkersReloadModels();
  });

  ipcMain.handle(IpcChannels.models.clearKey, async (_event, provider: string) => {
    const service = getModelsConfigService();
    await service.setProviderApiKey(provider, null);
    await broker.notifyWorkersReloadModels();
  });

  ipcMain.handle(IpcChannels.models.test, async () => {
    const runtime = await createRuntime();
    return listAvailableModels(runtime);
  });

  ipcMain.handle(
    IpcChannels.models.providerCatalog,
    async (_event, providerId: string): Promise<ProviderCatalogResult> => {
      const id = String(providerId ?? "").trim();
      const runtime = await createRuntime();
      const provider = runtime.getProvider(id);
      if (!provider) {
        return { providerId: id, api: "", baseUrl: "", models: [] };
      }
      const models = provider.getModels().map((m) => ({
        id: m.id,
        name: m.name || m.id,
        api: String(m.api),
        baseUrl: m.baseUrl ?? provider.baseUrl ?? "",
        reasoning: Boolean(m.reasoning),
        vision: Array.isArray(m.input) && m.input.includes("image"),
        contextWindow: Number(m.contextWindow) || 0,
        maxTokens: Number(m.maxTokens) || 0,
      }));
      return {
        providerId: id,
        api: models[0]?.api ?? "",
        baseUrl: provider.baseUrl ?? models[0]?.baseUrl ?? "",
        models,
      };
    },
  );

  ipcMain.handle(
    IpcChannels.models.testBaseUrl,
    async (
      _event,
      payload: { baseUrl: string; apiKey?: string; api?: string; providerId?: string },
    ): Promise<TestProviderBaseUrlResult> => {
      return testProviderBaseUrl(
        {
          baseUrl: String(payload?.baseUrl ?? ""),
          apiKey: await resolveProbeKey(payload?.apiKey, payload?.providerId),
          api: typeof payload?.api === "string" ? payload.api : undefined,
        },
        { fetchImpl: netFetch, signal: probeSignal(20_000) },
      );
    },
  );

  ipcMain.handle(
    IpcChannels.models.discover,
    async (
      _event,
      payload: { baseUrl: string; apiKey?: string; api?: string; providerId?: string },
    ): Promise<DiscoverModelsResult> => {
      const result = await discoverModels(
        {
          baseUrl: String(payload?.baseUrl ?? ""),
          apiKey: await resolveProbeKey(payload?.apiKey, payload?.providerId),
          api: typeof payload?.api === "string" ? payload.api : undefined,
        },
        { fetchImpl: netFetch, signal: probeSignal(30_000) },
      );
      if (!result.ok) return result;
      try {
        const config = await getModelsConfigService().readModelsConfig();
        const runtime = await createRuntime();
        const index = buildCatalogIndex(runtime, new Set(Object.keys(config.providers ?? {})));
        const models = resolveDiscoveredModels(enrichDiscoveredModels(result.models, index));
        return { ...result, models };
      } catch {
        // 内置目录不可用时保留端点原始结果
        return result;
      }
    },
  );

  ipcMain.handle(
    IpcChannels.models.testConnection,
    async (
      _event,
      payload: {
        baseUrl: string;
        apiKey?: string;
        api?: string;
        modelId: string;
        /** When set and apiKey omitted, use auth.json key for this provider id. */
        providerId?: string;
      },
    ): Promise<TestModelConnectionResult> => {
      const apiKey = await resolveProbeKey(payload?.apiKey, payload?.providerId);
      return testModelConnection(
        {
          baseUrl: String(payload?.baseUrl ?? ""),
          apiKey,
          api: typeof payload?.api === "string" ? payload.api : undefined,
          modelId: String(payload?.modelId ?? ""),
        },
        { fetchImpl: netFetch },
      );
    },
  );

  ipcMain.handle(
    IpcChannels.models.oauthLogin,
    async (event, rawProviderId: string): Promise<void> => {
      const providerId = String(rawProviderId ?? "").trim();
      if (!providerId) throw new Error("缺少提供商 ID");
      if (activeOauthLogin) throw new Error("已有登录流程正在进行");
      const runtime = await createRuntime();
      const session: ActiveOauthLogin = {
        providerId,
        controller: new AbortController(),
        promptSeq: 0,
        resolvePrompt: null,
        rejectPrompt: null,
      };
      activeOauthLogin = session;
      const sender = event.sender;
      const interaction: AuthInteraction = {
        signal: session.controller.signal,
        notify: (authEvent) => {
          console.info(`[oauth] ${providerId} event: ${authEvent.type}`);
          pushOauthEvent(sender, providerId, toOauthEvent(authEvent));
        },
        prompt: (prompt) => {
          console.info(`[oauth] ${providerId} prompt: ${prompt.type}`);
          return requestOauthPrompt(session, sender, prompt);
        },
      };
      try {
        await runtime.login(providerId, "oauth", interaction, {
          getDeviceId: await createDeviceIdProvider(),
        });
        console.info(`[oauth] ${providerId} login ok`);
        await broker.notifyWorkersReloadModels();
      } catch (err) {
        console.error(`[oauth] ${providerId} login failed:`, err);
        throw err;
      } finally {
        if (activeOauthLogin === session) activeOauthLogin = null;
      }
    },
  );

  ipcMain.handle(
    IpcChannels.models.oauthPrompt,
    async (_event, reply: ModelsOAuthPromptReply): Promise<void> => {
      const session = activeOauthLogin;
      if (!session || session.providerId !== String(reply?.providerId ?? "").trim()) return;
      if (reply?.cancelled) {
        session.rejectPrompt?.(new Error("登录已取消"));
        session.controller.abort();
        return;
      }
      session.resolvePrompt?.(String(reply?.value ?? ""));
    },
  );

  ipcMain.handle(IpcChannels.models.oauthCancel, async (): Promise<void> => {
    activeOauthLogin?.controller.abort();
  });

  ipcMain.handle(
    IpcChannels.models.oauthLogout,
    async (_event, rawProviderId: string): Promise<void> => {
      const providerId = String(rawProviderId ?? "").trim();
      if (!providerId) return;
      const runtime = await createRuntime();
      await runtime.logout(providerId);
      await broker.notifyWorkersReloadModels();
    },
  );
}

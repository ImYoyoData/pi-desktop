import { ipcMain, type WebContents } from "electron";

import { IpcChannels } from "../shared/protocol";
import type {
  ModelsGetResult,
  ModelsOAuthEvent,
  ModelsOAuthEventPayload,
  ModelsOAuthPrompt,
  ModelsOAuthPromptReply,
  ModelsProviderAuth,
  ModelsSetPayload,
  ProviderCatalogResult,
} from "../shared/models-settings";
import {
	discoverModels,
	testModelConnection,
	type DiscoverModelsResult,
	type TestModelConnectionResult,
} from "../shared/model-discover";
import type { SessionBroker } from "./session-broker";
import { getModelsConfigService } from "./models-config";
import { readModelSelection, writeModelSelection } from "./models-selection";
import type { ModelSelection } from "../shared/model-selection";
import type { AuthEvent, AuthInteraction, AuthPrompt, ModelRuntime } from "@earendil-works/pi-coding-agent";

async function createRuntime(): Promise<import("@earendil-works/pi-coding-agent").ModelRuntime> {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const { paths } = getModelsConfigService();
  return ModelRuntime.create({
    modelsPath: paths.modelsPath,
    authPath: paths.authPath,
  });
}

export async function listAvailableModels(runtime: ModelRuntime): Promise<ModelsGetResult["available"]> {
  const models = await runtime.getAvailable();
  return models
    .map((m) => ({
      provider: m.provider,
      id: m.id,
      name: m.name ?? m.id,
    }))
    .sort((a, b) => {
      const byProvider = a.provider.localeCompare(b.provider);
      if (byProvider !== 0) return byProvider;
      return (a.name || a.id).localeCompare(b.name || b.id, undefined, { numeric: true });
    });
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
    IpcChannels.models.discover,
    async (
      _event,
      payload: { baseUrl: string; apiKey?: string; api?: string },
    ): Promise<DiscoverModelsResult> => {
      return discoverModels({
        baseUrl: String(payload?.baseUrl ?? ""),
        apiKey: typeof payload?.apiKey === "string" ? payload.apiKey : undefined,
        api: typeof payload?.api === "string" ? payload.api : undefined,
      });
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
      let apiKey =
        typeof payload?.apiKey === "string" && payload.apiKey.trim()
          ? payload.apiKey.trim()
          : undefined;
      const providerId =
        typeof payload?.providerId === "string" ? payload.providerId.trim() : "";
      if (!apiKey && providerId) {
        const auth = await getModelsConfigService().readAuthConfig();
        const cred = auth[providerId];
        if (cred && cred.type === "api_key" && typeof cred.key === "string" && cred.key.trim()) {
          apiKey = cred.key.trim();
        }
      }
      return testModelConnection({
        baseUrl: String(payload?.baseUrl ?? ""),
        apiKey,
        api: typeof payload?.api === "string" ? payload.api : undefined,
        modelId: String(payload?.modelId ?? ""),
      });
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
        notify: (authEvent) => pushOauthEvent(sender, providerId, toOauthEvent(authEvent)),
        prompt: (prompt) => requestOauthPrompt(session, sender, prompt),
      };
      try {
        await runtime.login(providerId, "oauth", interaction);
        await broker.notifyWorkersReloadModels();
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

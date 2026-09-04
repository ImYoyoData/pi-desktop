import { ipcMain } from "electron";

import { IpcChannels } from "../shared/protocol";
import type { ModelsGetResult, ModelsProviderAuth, ModelsSetPayload } from "../shared/models-settings";
import {
	discoverModels,
	testModelConnection,
	type DiscoverModelsResult,
	type TestModelConnectionResult,
} from "../shared/model-discover";
import type { SessionBroker } from "./session-broker";
import { getModelsConfigService } from "./models-config";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

/** Providers that use OAuth — handled separately (pi-web /api/auth/all-providers) */
const OAUTH_PROVIDER_IDS = new Set(["anthropic", "github-copilot", "openai-codex"]);

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
 * Built-in API-key providers from Pi SDK (`getProviders`), with real auth status.
 * `modelCount` is the number of **usable** models (`getAvailable`), not the catalog size.
 */
function listApiKeyProviders(
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
    if (OAUTH_PROVIDER_IDS.has(provider.id) || !provider.auth?.apiKey?.login) continue;
    const status = runtime.getProviderAuthStatus(provider.id);
    if (status.source === "models_json_key") continue;
    result.push({
      id: provider.id,
      displayName: provider.name || provider.id,
      configured: status.configured,
      source: status.source,
      modelCount: availableCountByProvider.get(provider.id) ?? 0,
      supportsApiKey: true,
    });
  }

  result.sort((a, b) => {
    if (a.configured !== b.configured) return a.configured ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });
  return result;
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
    const providers = listApiKeyProviders(runtime, available);
    const apiKeyConfigured = Object.fromEntries(providers.map((p) => [p.id, p.configured]));
    return { modelsText, apiKeyConfigured, providers, available };
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
}

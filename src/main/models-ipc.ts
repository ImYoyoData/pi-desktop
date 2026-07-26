import { ipcMain } from "electron";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { IpcChannels } from "../shared/protocol";
import {
  COMMON_API_KEY_PROVIDERS,
  type ModelsGetResult,
  type ModelsSetPayload,
} from "../shared/models-settings";
import type { SessionBroker } from "./session-broker";
import { getModelsConfigService } from "./models-config";

async function listAvailableModels(): Promise<ModelsGetResult["available"]> {
  const { paths } = getModelsConfigService();
  const runtime = await ModelRuntime.create({
    modelsPath: paths.modelsPath,
    authPath: paths.authPath,
  });
  const models = await runtime.getAvailable();
  return models.map((m) => ({
    provider: m.provider,
    id: m.id,
    name: m.name ?? m.id,
  }));
}

export function registerModelsIpc(broker: SessionBroker): void {
  ipcMain.handle(IpcChannels.models.get, async (): Promise<ModelsGetResult> => {
    const service = getModelsConfigService();
    const [modelsText, apiKeyConfigured, available] = await Promise.all([
      service.readModelsConfigText(),
      service.getProviderKeyStatus(),
      listAvailableModels(),
    ]);
    return { modelsText, apiKeyConfigured, available };
  });

  ipcMain.handle(IpcChannels.models.set, async (_event, payload: ModelsSetPayload) => {
    const service = getModelsConfigService();
    await service.writeModelsConfigText(payload.modelsText);
    if (payload.apiKeys) {
      for (const provider of COMMON_API_KEY_PROVIDERS) {
        const key = payload.apiKeys[provider];
        if (key !== undefined) {
          await service.setProviderApiKey(provider, key || null);
        }
      }
    }
    await broker.notifyWorkersReloadModels();
  });

  ipcMain.handle(IpcChannels.models.test, async () => listAvailableModels());
}

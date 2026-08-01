import fs from "node:fs";
import path from "node:path";
import { agentDir } from "./agent-dir";
import type { ApiKeyCredential } from "@earendil-works/pi-ai";
import { COMMON_API_KEY_PROVIDERS } from "../shared/models-settings";

export type ModelsConfig = {
  providers?: Record<string, unknown>;
  modelOverrides?: Record<string, unknown>;
};

/** auth.json may contain api_key or oauth credentials */
export type AuthConfig = Record<
  string,
  ApiKeyCredential | { type: string; key?: string; access?: string; refresh?: string; [k: string]: unknown }
>;

export type ModelsConfigPaths = {
  modelsPath: string;
  authPath: string;
};

export function resolveModelsConfigPaths(agentDirOverride?: string): ModelsConfigPaths {
  const base = path.resolve(agentDirOverride ?? agentDir());
  return {
    modelsPath: path.join(base, "models.json"),
    authPath: path.join(base, "auth.json"),
  };
}

function ensureParent(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  ensureParent(filePath);
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const body = `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function createModelsConfig(paths: ModelsConfigPaths) {
  let writeQueue: Promise<void> = Promise.resolve();

  function enqueueWrite(task: () => void | Promise<void>): Promise<void> {
    writeQueue = writeQueue.then(task, task);
    return writeQueue;
  }

  async function readModelsConfig(): Promise<ModelsConfig> {
    return readJsonFile<ModelsConfig>(paths.modelsPath, {});
  }

  async function writeModelsConfig(next: ModelsConfig): Promise<void> {
    return enqueueWrite(() => {
      writeJsonAtomic(paths.modelsPath, next);
    });
  }

  async function readModelsConfigText(): Promise<string> {
    try {
      return fs.readFileSync(paths.modelsPath, "utf8");
    } catch {
      return `${JSON.stringify({ providers: {} }, null, 2)}\n`;
    }
  }

  async function writeModelsConfigText(text: string): Promise<void> {
    return enqueueWrite(() => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new Error(`Invalid models.json: ${err instanceof Error ? err.message : String(err)}`);
      }
      writeJsonAtomic(paths.modelsPath, parsed);
    });
  }

  async function readAuthConfig(): Promise<AuthConfig> {
    return readJsonFile<AuthConfig>(paths.authPath, {});
  }

  async function writeAuthConfig(next: AuthConfig): Promise<void> {
    return enqueueWrite(() => {
      writeJsonAtomic(paths.authPath, next);
    });
  }

  async function setProviderApiKey(provider: string, apiKey: string | null): Promise<void> {
    const auth = await readAuthConfig();
    const next = { ...auth };
    if (!apiKey?.trim()) {
      delete next[provider];
    } else {
      next[provider] = { type: "api_key", key: apiKey.trim() };
    }
    await writeAuthConfig(next);
  }

  async function getProviderKeyStatus(): Promise<Record<string, boolean>> {
    const auth = await readAuthConfig();
    const status: Record<string, boolean> = {};
    for (const [provider, cred] of Object.entries(auth)) {
      if (!cred) {
        status[provider] = false;
        continue;
      }
      if (cred.type === "api_key") {
        status[provider] = Boolean(cred.key?.trim());
      } else if (cred.type === "oauth") {
        status[provider] = Boolean(cred.access || cred.refresh);
      } else {
        status[provider] = true;
      }
    }
    for (const provider of COMMON_API_KEY_PROVIDERS) {
      if (status[provider] === undefined) status[provider] = false;
    }
    return status;
  }

  return {
    paths,
    readModelsConfig,
    writeModelsConfig,
    readModelsConfigText,
    writeModelsConfigText,
    readAuthConfig,
    writeAuthConfig,
    setProviderApiKey,
    getProviderKeyStatus,
  };
}

export type ModelsConfigService = ReturnType<typeof createModelsConfig>;

let defaultService: ModelsConfigService | null = null;

export function getModelsConfigService(): ModelsConfigService {
  if (!defaultService) {
    defaultService = createModelsConfig(resolveModelsConfigPaths());
  }
  return defaultService;
}

export async function readModelsConfig(): Promise<ModelsConfig> {
  return getModelsConfigService().readModelsConfig();
}

export async function writeModelsConfig(next: ModelsConfig): Promise<void> {
  return getModelsConfigService().writeModelsConfig(next);
}

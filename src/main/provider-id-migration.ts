import fs from "node:fs";
import path from "node:path";
import { agentDir } from "./agent-dir";

/** pi 1.0.3 的 provider 更名，配置里残留的旧 id 一次性改成新 id。 */
const LEGACY_PROVIDER_IDS: Record<string, string> = {
  "azure-openai-responses": "azure",
};

function renameProviderRef(value: string): string {
  for (const [legacy, next] of Object.entries(LEGACY_PROVIDER_IDS)) {
    if (value === legacy) return next;
    if (value.startsWith(`${legacy}/`)) return next + value.slice(legacy.length);
  }
  return value;
}

/** 对象键按 provider id 改名；同名冲突时保留先出现的值。 */
function renameKeys(record: Record<string, unknown>): boolean {
  let changed = false;
  for (const key of Object.keys(record)) {
    const renamed = renameProviderRef(key);
    if (renamed === key) continue;
    if (!(renamed in record)) record[renamed] = record[key];
    delete record[key];
    changed = true;
  }
  return changed;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function writeJson(file: string, data: Record<string, unknown>): void {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tmp, file);
}

function migrateAuth(root: Record<string, unknown>): boolean {
  return renameKeys(root);
}

function migrateModels(root: Record<string, unknown>): boolean {
  let changed = false;
  for (const key of ["providers", "modelOverrides"] as const) {
    const section = root[key];
    if (section && typeof section === "object" && !Array.isArray(section)) {
      changed = renameKeys(section as Record<string, unknown>) || changed;
    }
  }
  return changed;
}

function migrateSettings(root: Record<string, unknown>): boolean {
  let changed = false;
  if (typeof root.defaultProvider === "string") {
    const renamed = renameProviderRef(root.defaultProvider);
    if (renamed !== root.defaultProvider) {
      root.defaultProvider = renamed;
      changed = true;
    }
  }
  const enabledModels = root.enabledModels;
  if (Array.isArray(enabledModels)) {
    const list = enabledModels.map((item) =>
      typeof item === "string" ? renameProviderRef(item) : item,
    );
    if (list.some((item, i) => item !== enabledModels[i])) {
      root.enabledModels = list;
      changed = true;
    }
  }
  const levels = root.modelThinkingLevels;
  if (levels && typeof levels === "object" && !Array.isArray(levels)) {
    changed = renameKeys(levels as Record<string, unknown>) || changed;
  }
  return changed;
}

function migrateMcp(root: Record<string, unknown>): boolean {
  const servers = root.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return false;
  let changed = false;
  for (const value of Object.values(servers)) {
    const auth = (value as Record<string, unknown>)?.auth;
    if (!auth || typeof auth !== "object" || Array.isArray(auth)) continue;
    const provider = (auth as Record<string, unknown>).provider;
    if (typeof provider !== "string") continue;
    const renamed = renameProviderRef(provider);
    if (renamed === provider) continue;
    (auth as Record<string, unknown>).provider = renamed;
    changed = true;
  }
  return changed;
}

const MIGRATORS: Record<string, (root: Record<string, unknown>) => boolean> = {
  "auth.json": migrateAuth,
  "models.json": migrateModels,
  "settings.json": migrateSettings,
  "mcp.json": migrateMcp,
};

/** 启动时把 agent 目录配置里的旧 provider id 改成新 id，pi 才认得这些凭据与设置。 */
export function migrateLegacyProviderIds(agentDirOverride?: string): void {
  const base = path.resolve(agentDirOverride ?? agentDir());
  for (const [name, migrate] of Object.entries(MIGRATORS)) {
    const file = path.join(base, name);
    const root = readJson(file);
    if (!root || !migrate(root)) continue;
    writeJson(file, root);
  }
}

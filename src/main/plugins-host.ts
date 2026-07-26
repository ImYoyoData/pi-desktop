import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
  type PackageSource,
} from "@earendil-works/pi-coding-agent";

export type PluginScope = "global" | "project";

export type PluginPackageDto = {
  source: string;
  scope: PluginScope;
  disabled: boolean;
  installedPath?: string;
  status: "loaded" | "installed" | "missing" | "disabled";
};

function getPackageSource(entry: PackageSource): string {
  return typeof entry === "string" ? entry : entry.source;
}

function isDisabledPackage(entry: PackageSource): boolean {
  if (typeof entry === "string") return false;
  return (
    Array.isArray(entry.extensions) &&
    entry.extensions.length === 0 &&
    Array.isArray(entry.skills) &&
    entry.skills.length === 0 &&
    Array.isArray(entry.prompts) &&
    entry.prompts.length === 0 &&
    Array.isArray(entry.themes) &&
    entry.themes.length === 0
  );
}

function setPackageDisabled(
  settingsManager: SettingsManager,
  source: string,
  scope: PluginScope,
  disabled: boolean,
): boolean {
  const current =
    scope === "project"
      ? (settingsManager.getProjectSettings().packages ?? [])
      : (settingsManager.getGlobalSettings().packages ?? []);
  let changed = false;
  const next = current.map((entry): PackageSource => {
    if (getPackageSource(entry) !== source) return entry;
    changed = true;
    if (disabled) {
      return {
        ...(typeof entry === "string" ? { source: entry } : entry),
        extensions: [],
        skills: [],
        prompts: [],
        themes: [],
      };
    }
    return getPackageSource(entry);
  });
  if (!changed) return false;
  if (scope === "project") settingsManager.setProjectPackages(next);
  else settingsManager.setPackages(next);
  return true;
}

export async function listPlugins(cwd: string): Promise<{ packages: PluginPackageDto[] }> {
  const settingsManager = SettingsManager.create(cwd, getAgentDir());
  const packageManager = new DefaultPackageManager({
    cwd,
    agentDir: getAgentDir(),
    settingsManager,
  });

  const disabledMap = new Map<string, boolean>();
  for (const entry of settingsManager.getGlobalSettings().packages ?? []) {
    disabledMap.set(`global\0${getPackageSource(entry)}`, isDisabledPackage(entry));
  }
  for (const entry of settingsManager.getProjectSettings().packages ?? []) {
    disabledMap.set(`project\0${getPackageSource(entry)}`, isDisabledPackage(entry));
  }

  const packages = packageManager.listConfiguredPackages().map((pkg) => {
    const scope: PluginScope = pkg.scope === "project" ? "project" : "global";
    const disabled = disabledMap.get(`${scope}\0${pkg.source}`) ?? false;
    return {
      source: pkg.source,
      scope,
      disabled,
      installedPath: pkg.installedPath,
      status: disabled
        ? ("disabled" as const)
        : pkg.installedPath
          ? ("installed" as const)
          : ("missing" as const),
    };
  });

  return { packages };
}

export async function setPluginEnabled(
  cwd: string,
  source: string,
  scope: PluginScope,
  enabled: boolean,
): Promise<void> {
  const settingsManager = SettingsManager.create(cwd, getAgentDir());
  setPackageDisabled(settingsManager, source, scope, !enabled);
  await settingsManager.flush();
}

export async function removePlugin(
  cwd: string,
  source: string,
  scope: PluginScope,
): Promise<void> {
  const settingsManager = SettingsManager.create(cwd, getAgentDir());
  const packageManager = new DefaultPackageManager({
    cwd,
    agentDir: getAgentDir(),
    settingsManager,
  });
  await packageManager.removeAndPersist(source, { local: scope === "project" });
}

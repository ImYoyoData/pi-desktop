import { agentDir } from "./agent-dir";
import { resolveTrustState } from "./project-trust";
import {
  listAgentNpmExtensions,
  npmNameFromSource,
  removeAgentNpmExtension,
} from "./agent-npm-extensions";
import type { PackageSource } from "@earendil-works/pi-coding-agent";

export type PluginScope = "global" | "project";

/**
 * Plugin (pi package) management. The SDK classes are lazy-imported so the
 * main-process boot never parses the multi-MB pi-coding-agent bundle.
 * Uninstalling a module also removes it from the auto-loaded npm extensions
 * package (~/.pi/agent/npm/package.json), so it stops appearing in the agent.
 */

async function createSettingsManager(cwd: string) {
  const sdk = await import("@earendil-works/pi-coding-agent");
  return sdk.SettingsManager.create(cwd, sdk.getAgentDir(), {
    projectTrusted: resolveTrustState(cwd).projectTrusted,
  });
}

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
  settingsManager: import("@earendil-works/pi-coding-agent").SettingsManager,
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
  const { DefaultPackageManager } = await import("@earendil-works/pi-coding-agent");
  const settingsManager = await createSettingsManager(cwd);
  const packageManager = new DefaultPackageManager({
    cwd,
    agentDir: agentDir(),
    settingsManager,
  });

  const disabledMap = new Map<string, boolean>();
  for (const entry of settingsManager.getGlobalSettings().packages ?? []) {
    disabledMap.set(`global\0${getPackageSource(entry)}`, isDisabledPackage(entry));
  }
  for (const entry of settingsManager.getProjectSettings().packages ?? []) {
    disabledMap.set(`project\0${getPackageSource(entry)}`, isDisabledPackage(entry));
  }

  const packages: PluginPackageDto[] = packageManager.listConfiguredPackages().map((pkg) => {
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

  // Also surface npm packages auto-loaded from ~/.pi/agent/npm (e.g. ones
  // installed with `pi install` directly) so they can be disabled/removed here.
  const known = new Set(packages.map((p) => p.source));
  for (const ext of listAgentNpmExtensions()) {
    const source = `npm:${ext.name}`;
    if (known.has(source)) continue;
    known.add(source);
    packages.push({
      source,
      scope: "global",
      disabled: false,
      status: "installed",
    });
  }

  return { packages };
}

export async function setPluginEnabled(
  cwd: string,
  source: string,
  scope: PluginScope,
  enabled: boolean,
): Promise<void> {
  const settingsManager = await createSettingsManager(cwd);
  setPackageDisabled(settingsManager, source, scope, !enabled);
  await settingsManager.flush();
}

export async function removePlugin(
  cwd: string,
  source: string,
  scope: PluginScope,
): Promise<void> {
  const { DefaultPackageManager } = await import("@earendil-works/pi-coding-agent");
  const settingsManager = await createSettingsManager(cwd);
  const packageManager = new DefaultPackageManager({
    cwd,
    agentDir: agentDir(),
    settingsManager,
  });
  await packageManager.removeAndPersist(source, { local: scope === "project" });
  // Hard requirement: also drop it from the auto-loaded npm extension package
  // so it stops appearing in the agent's prompt extensions after uninstall.
  const npmName = npmNameFromSource(source);
  if (npmName) removeAgentNpmExtension(npmName);
}

import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { agentDir } from "./agent-dir";

/**
 * The `~/.pi/agent/npm` package ("pi-extensions") is what the Pi agent
 * auto-loads as extensions/prompts. The app's plugin list is driven by
 * settings.json `packages`, but uninstalling a module must ALSO remove it
 * here — otherwise the extension keeps loading into the agent even after
 * the app removes it from settings.
 */

export function npmExtensionsPackagePath(): string {
  return path.join(agentDir(), "npm", "package.json");
}

export type AgentNpmExtension = { name: string; version: string };

/** Read the deps of the auto-loaded pi-extensions package ([] when missing). */
export function listAgentNpmExtensions(): AgentNpmExtension[] {
  try {
    const raw = readFileSync(npmExtensionsPackagePath(), "utf8");
    const parsed = JSON.parse(raw) as { dependencies?: Record<string, string> };
    return Object.entries(parsed.dependencies ?? {}).map(([name, version]) => ({
      name,
      version,
    }));
  } catch {
    return [];
  }
}

/**
 * Record an npm package in the pi-extensions deps (best-effort version),
 * used after a successful install so the extension is guaranteed to load.
 */
export function addAgentNpmExtension(name: string, version = "*"): void {
  const pkgPath = npmExtensionsPackagePath();
  let pkg: { name?: string; dependencies?: Record<string, string> } = {};
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      name?: string;
      dependencies?: Record<string, string>;
    };
  } catch {
    pkg = { name: "pi-extensions", dependencies: {} };
  }
  if (!pkg.dependencies) pkg.dependencies = {};
  pkg.dependencies[name] = version;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

/**
 * Remove an npm package from the pi-extensions deps AND delete its installed
 * folder so the agent can no longer resolve it. Returns false when absent.
 */
export function removeAgentNpmExtension(name: string): boolean {
  const pkgPath = npmExtensionsPackagePath();
  if (!existsSync(pkgPath)) return false;
  let pkg: { dependencies?: Record<string, string> } = {};
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };
  } catch {
    return false;
  }
  const deps = { ...(pkg.dependencies ?? {}) };
  if (!(name in deps)) return false;
  delete deps[name];
  pkg.dependencies = deps;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  // Remove the installed folder (scoped packages live under @scope/name).
  const nodeModules = path.join(agentDir(), "npm", "node_modules");
  const targets = name.startsWith("@")
    ? [path.join(nodeModules, ...name.split("/"))]
    : [path.join(nodeModules, name)];
  for (const target of targets) {
    try {
      rmSync(target, { recursive: true, force: true });
    } catch {
      // ignore
    }
    // Prune now-empty scoped parents (@scope) so no empty dirs linger.
    try {
      const parent = path.dirname(target);
      if (path.basename(parent).startsWith("@") && readdirSync(parent).length === 0) {
        rmSync(parent, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }
  return true;
}

/** Extract the bare npm package name from a source like `npm:@scope/x` or `@scope/x`. */
export function npmNameFromSource(source: string): string | null {
  const raw = (source ?? "").trim();
  const name = raw.startsWith("npm:") ? raw.slice(4) : raw;
  if (!name || /[\s;|&<>"'`]/.test(name)) return null;
  if (name.startsWith("@")) {
    const parts = name.split("/");
    if (parts.length !== 2 || !parts[0].startsWith("@") || !parts[0].slice(1) || !parts[1]) return null;
  } else if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    return null;
  }
  return name;
}

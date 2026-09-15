import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { agentDir } from "./agent-dir";
import { resolveTrustState } from "./project-trust";
import {
	addAgentNpmExtension,
	agentNpmExtensionDir,
	listAgentNpmExtensions,
	npmNameFromSource,
	removeAgentNpmExtension,
} from "./agent-npm-extensions";
import { resolveNpmRunner } from "./bundled-npm";
import { isNewerVersion } from "../shared/update";
import type { PluginUpdateInfo } from "../shared/pi-market";
import type { PackageSource, SettingsManager } from "@earendil-works/pi-coding-agent";

export type PluginScope = "global" | "project";

/**
 * Plugin (pi package) management. The SDK classes are lazy-imported so the
 * main-process boot never parses the multi-MB pi-coding-agent bundle.
 * Uninstalling a module also removes it from the auto-loaded npm extensions
 * package (~/.pi/agent/npm/package.json), so it stops appearing in the agent.
 */

async function createSettingsManager(cwd: string) {
	const sdk = await import("@earendil-works/pi-coding-agent");
	const settings = sdk.SettingsManager.create(cwd, sdk.getAgentDir(), {
		projectTrusted: resolveTrustState(cwd).projectTrusted,
	});
	// Machines without a system Node/npm still get extension installs via the
	// bundled npm (Electron's Node). Priority: user-configured npmCommand >
	// system npm/pnpm on PATH > bundled npm. Only when the user has NOT
	// configured one AND no system package manager exists do we inject the
	// bundled npm — configured/system setups keep today's behavior untouched.
	const configured = settings.getNpmCommand();
	if (!configured || configured.length === 0) {
		const runner = resolveNpmRunner();
		if (runner.source === "bundled" || runner.source === "none") {
			settings.setNpmCommand([runner.command, ...runner.args]);
		}
	}
	return settings;
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

export async function listPlugins(
	cwd: string,
): Promise<{ packages: PluginPackageDto[] }> {
	const { DefaultPackageManager } = await import(
		"@earendil-works/pi-coding-agent"
	);
	const settingsManager = await createSettingsManager(cwd);
	const packageManager = new DefaultPackageManager({
		cwd,
		agentDir: agentDir(),
		settingsManager,
	});

	const disabledMap = new Map<string, boolean>();
	for (const entry of settingsManager.getGlobalSettings().packages ?? []) {
		disabledMap.set(
			`global\0${getPackageSource(entry)}`,
			isDisabledPackage(entry),
		);
	}
	for (const entry of settingsManager.getProjectSettings().packages ?? []) {
		disabledMap.set(
			`project\0${getPackageSource(entry)}`,
			isDisabledPackage(entry),
		);
	}

	const packages: PluginPackageDto[] = packageManager
		.listConfiguredPackages()
		.map((pkg) => {
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
		const installedPath = agentNpmExtensionDir(ext.name);
		const installed = existsSync(installedPath);
		packages.push({
			source,
			scope: "global",
			disabled: false,
			installedPath: installed ? installedPath : undefined,
			status: installed ? "installed" : "missing",
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
	const { DefaultPackageManager } = await import(
		"@earendil-works/pi-coding-agent"
	);
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

type NpmRunner = { command: string; args: string[] };

/** 离线模式（PI_OFFLINE）下不做任何网络检查与安装。 */
function isOfflineMode(): boolean {
	const value = process.env.PI_OFFLINE?.trim().toLowerCase();
	return value === "1" || value === "true" || value === "yes";
}

/** 包名合法性校验，避免拼接进命令行时被注入。 */
function isValidNpmName(name: string): boolean {
	return name.length > 0 && !/[\s;|&<>]/.test(name);
}

function npmRunnerFromSettings(settingsManager: SettingsManager): NpmRunner | null {
	const configured = settingsManager.getNpmCommand();
	if (configured && configured.length > 0) {
		return { command: configured[0]!, args: configured.slice(1) };
	}
	const runner = resolveNpmRunner();
	if (runner.source === "none") return null;
	return { command: runner.command, args: runner.args };
}

function runNpm(
	runner: NpmRunner,
	args: string[],
	options: { cwd?: string; timeoutMs: number },
): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(runner.command, [...runner.args, ...args], {
			cwd: options.cwd,
			windowsHide: true,
			shell: process.platform === "win32" && runner.command !== process.execPath,
			env: {
				...process.env,
				ELECTRON_RUN_AS_NODE: "1",
				CI: "1",
				NO_COLOR: "1",
				npm_config_fund: "false",
				npm_config_audit: "false",
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			try {
				child.kill();
			} catch {
				// ignore
			}
			reject(new Error("npm command timed out"));
		}, options.timeoutMs);
		child.stdout?.on("data", (d) => {
			stdout += String(d);
		});
		child.stderr?.on("data", (d) => {
			stderr += String(d);
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) resolve(stdout);
			else reject(new Error(stderr.trim() || `Exit code ${code ?? 1}`));
		});
	});
}

function readPackageVersion(dir: string | undefined): string | null {
	if (!dir) return null;
	const manifest = join(dir, "package.json");
	if (!existsSync(manifest)) return null;
	try {
		const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
			version?: string;
		};
		return parsed.version?.trim() || null;
	} catch {
		return null;
	}
}

async function fetchLatestNpmVersion(
	runner: NpmRunner,
	packageName: string,
): Promise<string | null> {
	if (!isValidNpmName(packageName)) return null;
	try {
		const raw = (
			await runNpm(runner, ["view", packageName, "version", "--json"], {
				timeoutMs: 60_000,
			})
		).trim();
		const parsed = JSON.parse(raw) as unknown;
		if (typeof parsed === "string") return parsed.trim() || null;
		if (Array.isArray(parsed)) {
			const versions = parsed.filter(
				(value): value is string => typeof value === "string" && value.length > 0,
			);
			return versions.reduce<string | null>(
				(max, version) => (max === null || isNewerVersion(version, max) ? version : max),
				null,
			);
		}
	} catch {
		return null;
	}
	return null;
}

/** 检查可更新插件：settings 中的包交给 SDK（npm/git），自动加载的 npm 扩展单独比对。 */
export async function checkPluginUpdates(cwd: string): Promise<PluginUpdateInfo[]> {
	if (isOfflineMode()) return [];
	const { DefaultPackageManager } = await import(
		"@earendil-works/pi-coding-agent"
	);
	const settingsManager = await createSettingsManager(cwd);
	const packageManager = new DefaultPackageManager({
		cwd,
		agentDir: agentDir(),
		settingsManager,
	});
	const updates = await packageManager.checkForAvailableUpdates();
	const result: PluginUpdateInfo[] = updates.map((entry) => ({
		source: entry.source,
		scope: entry.scope === "project" ? "project" : "global",
	}));
	const known = new Set(result.map((entry) => `${entry.scope}\0${entry.source}`));

	const runner = npmRunnerFromSettings(settingsManager);
	if (!runner) return result;
	for (const ext of listAgentNpmExtensions()) {
		const source = `npm:${ext.name}`;
		const key = `global\0${source}`;
		if (known.has(key)) continue;
		const current = readPackageVersion(agentNpmExtensionDir(ext.name));
		if (!current) continue;
		const latest = await fetchLatestNpmVersion(runner, ext.name);
		if (!latest || !isNewerVersion(latest, current)) continue;
		known.add(key);
		result.push({ source, scope: "global" });
	}
	return result;
}

/** 更新单个插件：settings 内的包走 SDK 的 update，自动加载的 npm 扩展就地装最新版。 */
export async function updatePlugin(
	cwd: string,
	source: string,
	scope: PluginScope,
): Promise<void> {
	const { DefaultPackageManager } = await import(
		"@earendil-works/pi-coding-agent"
	);
	const settingsManager = await createSettingsManager(cwd);
	const packageManager = new DefaultPackageManager({
		cwd,
		agentDir: agentDir(),
		settingsManager,
	});
	const configured = packageManager
		.listConfiguredPackages()
		.some(
			(pkg) =>
				pkg.source === source &&
				(pkg.scope === "project" ? "project" : "global") === scope,
		);
	if (configured) {
		await packageManager.update(source);
		return;
	}

	const npmName = npmNameFromSource(source);
	if (!npmName || !isValidNpmName(npmName)) {
		throw new Error(`No matching package: ${source}`);
	}
	const runner = npmRunnerFromSettings(settingsManager);
	if (!runner) throw new Error("No package manager available");
	await runNpm(runner, ["install", `${npmName}@latest`], {
		cwd: join(agentDir(), "npm"),
		timeoutMs: 180_000,
	});
	addAgentNpmExtension(npmName);
}

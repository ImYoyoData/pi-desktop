import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow } from "electron";
import { agentDir } from "./agent-dir";
import {
	addAgentNpmExtension,
	agentNpmExtensionDir,
	listAgentNpmExtensions,
	npmNameFromSource,
	removeAgentNpmExtension,
} from "./agent-npm-extensions";
import { resolveNpmRunner } from "./bundled-npm";
import { isNewerVersion } from "../shared/update";
import { IpcChannels } from "../shared/protocol";
import type { PluginUpdateProgress, PluginVersionInfo } from "../shared/pi-market";
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
		projectTrusted: true,
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

/** 广播升级进度（渲染端按 source/scope 匹配插件行）。 */
function broadcastUpdateProgress(progress: PluginUpdateProgress): void {
	for (const win of BrowserWindow.getAllWindows()) {
		win.webContents.send(IpcChannels.plugins.updateProgress, progress);
	}
}

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
	options: { cwd?: string; timeoutMs: number; onStderrLine?: (line: string) => void },
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
		let stderrTail = "";
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
			const text = String(d);
			stderr += text;
			if (!options.onStderrLine) return;
			stderrTail += text;
			const lines = stderrTail.split(/\r?\n/);
			stderrTail = lines.pop() ?? "";
			for (const line of lines) options.onStderrLine(line);
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

function packageNameFromUrl(url: string): string | null {
	try {
		const parts = new URL(url).pathname.split("/").filter(Boolean);
		if (parts[0]?.startsWith("@")) return parts[1] ? `${parts[0]}/${parts[1]}` : null;
		return parts[0] ?? null;
	} catch {
		return null;
	}
}

/** 从 npm 的 http 日志行提取正在获取的包名。 */
function npmHttpPackageName(line: string): string | null {
	const fetched = /^npm http fetch \S+ \d+ (\S+)/.exec(line);
	if (fetched?.[1]) return packageNameFromUrl(fetched[1]);
	const cached = /^npm http cache (\S+?)@\S+/.exec(line);
	return cached?.[1] ?? null;
}

function packageManagerKind(runner: NpmRunner): "npm" | "pnpm" | "bun" {
	const base = (runner.command.split(/[\\/]/).pop() ?? "")
		.replace(/\.(cmd|exe)$/i, "")
		.toLowerCase();
	if (base === "pnpm") return "pnpm";
	if (base === "bun") return "bun";
	return "npm";
}

/** SDK 管理的 npm 安装根目录（与 DefaultPackageManager.getNpmInstallRoot 一致）。 */
function npmInstallRoot(cwd: string, scope: PluginScope): string {
	return scope === "project" ? join(cwd, ".pi", "npm") : join(agentDir(), "npm");
}

/** 与 SDK 相同的安装参数，额外给 npm 打开 http 日志供解析进度。 */
function npmInstallArgs(kind: "npm" | "pnpm" | "bun", spec: string, root: string): string[] {
	if (kind === "bun") return ["install", spec, "--cwd", root, "--omit=peer"];
	if (kind === "pnpm") {
		return [
			"install",
			spec,
			"--prefix",
			root,
			"--config.auto-install-peers=false",
			"--config.strict-peer-dependencies=false",
			"--config.strict-dep-builds=false",
		];
	}
	// npm 12 默认 allow-remote=none 且拦截 install scripts，插件的 URL 依赖与原生模块构建需要显式放开。
	return [
		"install",
		spec,
		"--prefix",
		root,
		"--legacy-peer-deps",
		"--allow-remote=all",
		"--dangerously-allow-all-scripts",
		"--loglevel=http",
	];
}

/** git fetch 预热：只拉取对象不改变工作区，用于展示真实下载百分比。 */
function prefetchGit(dir: string, onPercent: (percent: number) => void): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn("git", ["fetch", "--progress", "--all"], {
			cwd: dir,
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let tail = "";
		const timer = setTimeout(() => {
			try {
				child.kill();
			} catch {
				// ignore
			}
			reject(new Error("git fetch timed out"));
		}, 120_000);
		const consume = (text: string): void => {
			tail += text;
			const lines = tail.split(/\r?\n/);
			tail = lines.pop() ?? "";
			for (const line of lines) {
				const match = /(?:Receiving objects|Resolving deltas):\s+(\d+)%/.exec(line);
				if (match?.[1]) onPercent(Number(match[1]));
			}
		};
		child.stdout?.on("data", (d) => consume(String(d)));
		child.stderr?.on("data", (d) => consume(String(d)));
		child.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) resolve();
			else reject(new Error(`git fetch exited ${code ?? 1}`));
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

/** 检查所有插件的版本信息：npm 包比对本地/最新版本，git 包沿用 SDK 的更新检查。 */
export async function checkPluginUpdates(cwd: string): Promise<PluginVersionInfo[]> {
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
	const { packages } = await listPlugins(cwd);
	const sdkUpdates = await packageManager.checkForAvailableUpdates();
	const sdkKeys = new Set(
		sdkUpdates.map(
			(entry) => `${entry.scope === "project" ? "project" : "global"}\0${entry.source}`,
		),
	);
	const configuredKeys = new Set(
		packageManager
			.listConfiguredPackages()
			.map((pkg) => `${pkg.scope === "project" ? "project" : "global"}\0${pkg.source}`),
	);
	const runner = npmRunnerFromSettings(settingsManager);

	const result: PluginVersionInfo[] = [];
	for (const pkg of packages) {
		const key = `${pkg.scope}\0${pkg.source}`;
		const currentVersion = readPackageVersion(pkg.installedPath);
		const npmName = npmNameFromSource(pkg.source);
		let latestVersion: string | null = null;
		let hasUpdate = sdkKeys.has(key);

		if (npmName && runner) {
			if (hasUpdate) {
				latestVersion = await fetchLatestNpmVersion(runner, npmName);
			} else if (!configuredKeys.has(key)) {
				// 自动加载的 npm 扩展不在包管理器管辖内，单独比对版本。
				const latest = await fetchLatestNpmVersion(runner, npmName);
				latestVersion = latest;
				hasUpdate = Boolean(currentVersion && latest && isNewerVersion(latest, currentVersion));
			} else {
				latestVersion = currentVersion;
			}
		}
		result.push({
			source: pkg.source,
			scope: pkg.scope,
			currentVersion,
			latestVersion,
			hasUpdate,
		});
	}
	return result;
}

let updateQueue: Promise<unknown> = Promise.resolve();

/** 更新单个插件：多个请求排队执行，避免并发写入同一安装目录。 */
export function updatePlugin(
	cwd: string,
	source: string,
	scope: PluginScope,
): Promise<void> {
	broadcastUpdateProgress({ source, scope, phase: "prepare" });
	const task = updateQueue.then(async () => {
		try {
			await runPluginUpdate(cwd, source, scope);
			broadcastUpdateProgress({ source, scope, phase: "done" });
		} catch (err) {
			broadcastUpdateProgress({
				source,
				scope,
				phase: "error",
				error: err instanceof Error ? err.message : String(err),
			});
			throw err;
		}
	});
	updateQueue = task.catch(() => undefined);
	return task;
}

/** 自行执行 npm 安装以解析输出显示正在获取的包；成功后返回 true。 */
async function updateNpmPackage(
	cwd: string,
	source: string,
	scope: PluginScope,
	name: string,
	runner: NpmRunner,
	configured: boolean,
): Promise<boolean> {
	const kind = packageManagerKind(runner);
	let lastPackage: string | null = null;
	await runNpm(runner, npmInstallArgs(kind, `${name}@latest`, npmInstallRoot(cwd, scope)), {
		timeoutMs: 180_000,
		onStderrLine:
			kind === "npm"
				? (line) => {
						const pkg = npmHttpPackageName(line);
						if (!pkg || pkg === lastPackage) return;
						lastPackage = pkg;
						broadcastUpdateProgress({ source, scope, phase: "fetch", packageName: pkg });
					}
				: undefined,
	});
	if (!configured && scope === "global") addAgentNpmExtension(name);
	return true;
}

/** 更新单个插件：npm 包自行执行以解析输出，git 包先用 fetch 展示真实进度再交给 SDK。 */
async function runPluginUpdate(
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

	const installedPath = packageManager.getInstalledPath(
		source,
		scope === "project" ? "project" : "user",
	);
	if (installedPath && existsSync(join(installedPath, ".git"))) {
		let lastPercent = -1;
		try {
			await prefetchGit(installedPath, (percent) => {
				if (percent === lastPercent) return;
				lastPercent = percent;
				broadcastUpdateProgress({ source, scope, phase: "fetch", percent });
			});
		} catch {
			// git 预热失败不阻断 SDK 更新
		}
		await packageManager.update(source);
		return;
	}

	const npmName = npmNameFromSource(source);
	const runner = npmRunnerFromSettings(settingsManager);
	if (npmName && isValidNpmName(npmName) && runner) {
		const configured = packageManager
			.listConfiguredPackages()
			.some(
				(pkg) =>
					pkg.source === source &&
					(pkg.scope === "project" ? "project" : "global") === scope,
			);
		if (await updateNpmPackage(cwd, source, scope, npmName, runner, configured)) {
			return;
		}
	}

	await packageManager.update(source);
}

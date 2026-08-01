import { app, ipcMain } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { IpcChannels } from "../shared/protocol";
import { getWorkspace } from "./workspace-ipc";
import {
	addAgentNpmExtension,
	npmNameFromSource,
} from "./agent-npm-extensions";
import { resolveNpmRunner } from "./bundled-npm";
import {
	PI_PACKAGES_CATALOG_URL,
	piInstallCommand,
	piPackagesHasMore,
	type PiPackageInstallResult,
	type PiPackageListItem,
	type PiPackageListResult,
	type PiPackageType,
} from "../shared/pi-market";

async function resolvePiPath(): Promise<string | null> {
	const home = homedir();
	const names =
		process.platform === "win32"
			? [
					join(home, ".bun", "bin", "pi.exe"),
					join(home, "AppData", "Roaming", "npm", "pi.cmd"),
					join(home, "AppData", "Local", "pnpm", "pi.CMD"),
					join(home, "AppData", "Local", "pnpm", "pi.exe"),
				]
			: [
					join(home, ".bun", "bin", "pi"),
					join(home, ".local", "share", "pnpm", "pi"),
					join(home, ".npm-global", "bin", "pi"),
					"/usr/local/bin/pi",
					"/opt/homebrew/bin/pi",
				];
	for (const p of names) {
		if (existsSync(p)) return p;
	}
	// Fall back to PATH lookup via `where`/`which` is heavier; try bare `pi`.
	return process.platform === "win32" ? "pi.cmd" : "pi";
}

function decodeHtml(text: string): string {
	return text
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/<[^>]+>/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function parseCatalogHtml(html: string): {
	items: PiPackageListItem[];
	totalHint: string | null;
} {
	const items: PiPackageListItem[] = [];
	const seen = new Set<string>();

	// Main grid cards: <h3 class="packages-name"><a ...>name</a></h3><p class="packages-desc">...</p>
	const cardRe =
		/class="packages-name"\s*>\s*<a\s+[^>]*href="\/packages\/([^"?#]+)[^"]*"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>\s*<p\s+class="packages-desc">([\s\S]*?)<\/p>/gi;
	let m: RegExpExecArray | null;
	while ((m = cardRe.exec(html)) !== null) {
		const name = decodeURIComponent(m[1]!).trim();
		if (!name || seen.has(name)) continue;
		seen.add(name);
		items.push({
			name,
			description: decodeHtml(m[3] ?? ""),
			path: `/packages/${name}`,
		});
	}

	// Recent strip fallback
	const recentRe =
		/<a\s+[^>]*href="\/packages\/([^"?#]+)[^"]*"[^>]*class="[^"]*packages-recent-item[^"]*"[^>]*>\s*<strong>([\s\S]*?)<\/strong>\s*<span>([\s\S]*?)<\/span>(?:\s*<small>([\s\S]*?)<\/small>)?/gi;
	while ((m = recentRe.exec(html)) !== null) {
		const name = decodeURIComponent(m[1]!).trim();
		if (!name || seen.has(name)) continue;
		seen.add(name);
		items.push({
			name,
			description: decodeHtml(m[3] ?? ""),
			path: `/packages/${name}`,
			updatedLabel: m[4] ? decodeHtml(m[4]) : undefined,
		});
	}

	const totalMatch = html.match(/class="packages-count"[^>]*>([^<]+)</i);
	return {
		items,
		totalHint: totalMatch?.[1]?.trim() ?? null,
	};
}

export async function listPiPackages(opts?: {
	query?: string;
	type?: PiPackageType;
	page?: number;
}): Promise<PiPackageListResult> {
	const page = Math.max(1, Math.floor(opts?.page ?? 1));
	const params = new URLSearchParams();
	const q = opts?.query?.trim();
	if (q) params.set("name", q);
	if (opts?.type) params.set("type", opts.type);
	if (page > 1) params.set("page", String(page));
	const sourceUrl = params.toString()
		? `${PI_PACKAGES_CATALOG_URL}?${params.toString()}`
		: PI_PACKAGES_CATALOG_URL;

	try {
		const res = await fetch(sourceUrl, {
			headers: {
				Accept: "text/html",
				"User-Agent": "pi-desktop",
			},
		});
		if (!res.ok) {
			return {
				ok: false,
				items: [],
				totalHint: null,
				page,
				hasMore: false,
				error: `HTTP ${res.status}`,
				sourceUrl,
			};
		}
		const html = await res.text();
		const { items, totalHint } = parseCatalogHtml(html);
		return {
			ok: true,
			items,
			totalHint,
			page,
			hasMore: piPackagesHasMore(totalHint, page, items.length),
			error: null,
			sourceUrl,
		};
	} catch (err) {
		return {
			ok: false,
			items: [],
			totalHint: null,
			page,
			hasMore: false,
			error: err instanceof Error ? err.message : String(err),
			sourceUrl,
		};
	}
}

/**
 * Install a Pi package without a system pi CLI: drive the SDK's package
 * manager with the bundled npm (Electron's Node). Preserves the same
 * npm:<name> source semantics and records the module in the auto-loaded
 * pi-extensions package afterwards.
 */
async function installViaBundledNpm(
	name: string,
	command: string,
): Promise<PiPackageInstallResult> {
	const runner = resolveNpmRunner();
	if (runner.source === "none") {
		return {
			ok: false,
			command,
			log: "",
			error:
				"No package manager available — install Node.js or use a system pi CLI.",
		};
	}
	const source = `npm:${name}`;
	const log: string[] = [];
	try {
		const { DefaultPackageManager, SettingsManager, getAgentDir } =
			await import("@earendil-works/pi-coding-agent");
		const cwd = getWorkspace() ?? app.getPath("home");
		const settings = SettingsManager.create(cwd, getAgentDir(), {});
		// Point the manager at the resolved runner (system npm or bundled npm).
		settings.setNpmCommand([runner.command, ...runner.args]);
		const pm = new DefaultPackageManager({
			cwd,
			agentDir: getAgentDir(),
			settingsManager: settings,
		});
		// npm:<name> is the same source form `pi install` uses for registry packages.
		await pm.installAndPersist(source, { local: false });
		log.push(
			`Installed ${source} via ${runner.source === "bundled" ? "bundled npm" : runner.source}`,
		);
		const npmName = npmNameFromSource(source);
		if (npmName) {
			try {
				addAgentNpmExtension(npmName);
				log.push(`Recorded ${npmName} in pi-extensions`);
			} catch (err) {
				console.warn("[market] failed to record npm extension", err);
			}
		}
		return { ok: true, command, log: log.join("\n"), error: null };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		log.push(`Error: ${msg}`);
		return { ok: false, command, log: log.join("\n"), error: msg };
	}
}

export async function installPiPackage(
	packageName: string,
): Promise<PiPackageInstallResult> {
	const name = packageName.trim();
	if (!name || /[\s;|&<>]/.test(name)) {
		return { ok: false, command: "", log: "", error: "Invalid package name" };
	}
	const command = piInstallCommand(name);
	const piPath = await resolvePiPath();
	// No system pi CLI? Fall back to the SDK's package manager driven by the
	// bundled npm (machines without Node/npm still work).
	if (!piPath) {
		return installViaBundledNpm(name, command);
	}

	return new Promise((resolve) => {
		const args = ["install", `npm:${name}`];
		const child = spawn(piPath, args, {
			windowsHide: true,
			shell: process.platform === "win32",
			env: { ...process.env, CI: "1", NO_COLOR: "1" },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let log = "";
		const timer = setTimeout(() => {
			try {
				child.kill();
			} catch {
				// ignore
			}
			resolve({ ok: false, command, log, error: "Install timed out" });
		}, 180_000);
		child.stdout?.on("data", (d) => {
			log += String(d);
		});
		child.stderr?.on("data", (d) => {
			log += String(d);
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			resolve({ ok: false, command, log, error: err.message });
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) {
				// Guarantee the module is recorded in the auto-loaded pi-extensions
				// package so it is actually added to the agent's prompt extensions.
				const npmName = npmNameFromSource(`npm:${name}`);
				if (npmName) {
					try {
						addAgentNpmExtension(npmName);
					} catch (err) {
						console.warn("[market] failed to record npm extension", err);
					}
				}
				resolve({ ok: true, command, log, error: null });
			} else {
				resolve({
					ok: false,
					command,
					log,
					error: `Exit code ${code ?? 1}`,
				});
			}
		});
	});
}

export function registerMarketIpc(broker?: {
	restartWorkersForCwd: (cwd: string) => Promise<void>;
	getWorkspace?: () => string | null;
}): void {
	ipcMain.handle(
		IpcChannels.market.list,
		(_event, opts?: { query?: string; type?: PiPackageType; page?: number }) =>
			listPiPackages(opts),
	);
	ipcMain.handle(
		IpcChannels.market.install,
		async (_event, packageName: string) => {
			const result = await installPiPackage(packageName);
			if (result.ok) {
				const root = broker?.getWorkspace?.() ?? null;
				if (root) await broker?.restartWorkersForCwd(root);
			}
			return result;
		},
	);
}

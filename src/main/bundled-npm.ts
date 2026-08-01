import { app } from "electron";
import { existsSync } from "fs";
import { join } from "path";

/**
 * Bundled npm support — lets Pi Desktop install Pi extensions and manage the
 * global agent config on machines that have NO system Node / npm / pi CLI.
 *
 * npm is a pure-JS package shipped inside the app's dependencies; Electron's
 * bundled Node (process.execPath + ELECTRON_RUN_AS_NODE) executes it, so no
 * system runtime is required.
 *
 * Resolution priority (checked by callers):
 *   1. system `pi` CLI (full compatibility — everything as today)
 *   2. system npm / pnpm
 *   3. bundled npm (this module)
 */

/** npm-cli.js entry inside the app's dependencies. */
export function bundledNpmCliPath(): string {
	// Dev: node_modules/npm/bin/npm-cli.js. Packaged: app.asar.unpacked keeps the
	// native/node_modules tree outside the asar so Electron Node can resolve it.
	return join(
		__dirname,
		"..",
		"..",
		"node_modules",
		"npm",
		"bin",
		"npm-cli.js",
	);
}

/** True when the bundled npm cli is present in this install. */
export function bundledNpmAvailable(): boolean {
	return existsSync(bundledNpmCliPath());
}

/**
 * Command vector to run the bundled npm with Electron's Node:
 *   [electronExecutable, ELECTRON_RUN_AS_NODE=1, npm-cli.js, ...args]
 * Returns null when the bundled npm is missing.
 */
export function bundledNpmCommand(): string[] | null {
	if (!bundledNpmAvailable()) return null;
	const npmCli = bundledNpmCliPath();
	return [process.execPath, npmCli];
}

/**
 * Environment for running the bundled npm: ELECTRON_RUN_AS_NODE turns the
 * Electron binary into a plain Node runtime.
 */
export function bundledNpmEnv(): NodeJS.ProcessEnv {
	return {
		...process.env,
		ELECTRON_RUN_AS_NODE: "1",
		// Keep npm quiet / deterministic for programmatic use.
		CI: "1",
		NO_COLOR: "1",
		npm_config_fund: "false",
		npm_config_audit: "false",
	};
}

/** Human-readable label for logs ("bundled npm" vs a system command). */
export function bundledNpmLabel(): string {
	return `bundled npm (${bundledNpmCliPath()})`;
}

/** True when the system PATH resolves a package manager (npm/pnpm/bun). */
export function systemPackageManagerAvailable(
	candidates = ["npm", "pnpm", "bun"],
): boolean {
	const { execFileSync } =
		require("node:child_process") as typeof import("node:child_process");
	const { platform } = process;
	const check = platform === "win32" ? "where.exe" : "which";
	for (const name of candidates) {
		try {
			execFileSync(check, [name], { stdio: "ignore", timeout: 3000 });
			return true;
		} catch {
			// not on PATH — try next
		}
	}
	return false;
}

/** Compatibility guard: Electron's app reference for usage in main process. */
export function assertElectronMain(): void {
	if (!app) {
		throw new Error("bundled-npm requires Electron main process");
	}
}

/**
 * Resolve the npm runner to use, in priority order:
 *   1. `npmCommand` already configured in settings (user override wins).
 *   2. System npm / pnpm on PATH (full compatibility — behaves as today).
 *   3. Bundled npm (Electron Node + shipped npm package) — machines with no
 *      system Node/npm at all.
 * Returns { command, args } where command is the executable and args the
 * prefix (e.g. bundled npm -> [electronExec, "npm-cli.js"]).
 */
export function resolveNpmRunner(configured?: string[]): {
	command: string;
	args: string[];
	source: "configured" | "system" | "bundled" | "none";
} {
	if (configured && configured.length > 0) {
		return {
			command: configured[0]!,
			args: configured.slice(1),
			source: "configured",
		};
	}
	const { execFileSync } =
		require("node:child_process") as typeof import("node:child_process");
	const check = process.platform === "win32" ? "where.exe" : "which";
	for (const name of ["npm", "pnpm", "bun"]) {
		try {
			execFileSync(check, [name], { stdio: "ignore", timeout: 3000 });
			return { command: name, args: [], source: "system" };
		} catch {
			// not on PATH — try next
		}
	}
	const bundled = bundledNpmCommand();
	if (bundled) {
		return { command: bundled[0]!, args: bundled.slice(1), source: "bundled" };
	}
	return { command: "npm", args: [], source: "none" };
}

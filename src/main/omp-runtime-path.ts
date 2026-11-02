import { existsSync } from "node:fs";
import path from "node:path";

export type OmpRuntime = { command: string; args: string[] };

function bunBinaryName(): string {
	return process.platform === "win32" ? "bun.exe" : "bun";
}

function bunPackageName(): string {
	const platform =
		process.platform === "win32"
			? "windows"
			: process.platform === "darwin"
				? "darwin"
				: "linux";
	const arch = process.arch === "arm64" ? "aarch64" : "x64";
	return `@oven/bun-${platform}-${arch}`;
}

function findBun(searchRoots: string[]): string {
	const explicit = process.env.PI_DESKTOP_BUN_PATH?.trim();
	if (explicit && existsSync(explicit)) {
		return explicit;
	}
	for (const root of searchRoots) {
		const candidate = path.join(
			root,
			"node_modules",
			bunPackageName(),
			"bin",
			bunBinaryName(),
		);
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	// PATH 兜底：包管理器全局安装的 bun。
	return "bun";
}

/** 编译产物优先，其次用 bun 直接跑 TS 源码（开发态）。 */
export function resolveOmpRuntime(searchRoots: string[]): OmpRuntime {
	const binary = process.env.PI_DESKTOP_OMP_WORKER?.trim();
	if (binary && existsSync(binary)) {
		return { command: binary, args: [] };
	}
	const resources =
		typeof process.resourcesPath === "string" ? process.resourcesPath : "";
	if (resources) {
		const packaged = path.join(
			resources,
			"omp",
			process.platform === "win32" ? "omp-worker.exe" : "omp-worker",
		);
		if (existsSync(packaged)) {
			return { command: packaged, args: [] };
		}
	}
	for (const root of searchRoots) {
		const script = path.join(root, "src", "omp-worker", "index.ts");
		if (existsSync(script)) {
			return { command: findBun(searchRoots), args: [script] };
		}
	}
	throw new Error(
		"OMP worker runtime not found: build omp-worker or set PI_DESKTOP_OMP_WORKER / PI_DESKTOP_BUN_PATH",
	);
}

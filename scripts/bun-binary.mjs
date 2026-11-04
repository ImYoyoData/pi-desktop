import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

/**
 * 定位 bun 可执行文件。
 *
 * npm 的 bun 包在部分平台需要 postinstall 解压，未跑时退回 @oven 的预编译包；
 * 两者都没有时用 PATH 里的 bun。
 */
export function bunBinary() {
	const explicit = process.env.PI_DESKTOP_BUN_PATH?.trim();
	if (explicit && existsSync(explicit)) return explicit;
	const platform =
		process.platform === "win32"
			? "windows"
			: process.platform === "darwin"
				? "darwin"
				: "linux";
	const arch = process.arch === "arm64" ? "aarch64" : "x64";
	const local = path.join(
		root,
		"node_modules",
		`@oven/bun-${platform}-${arch}`,
		"bin",
		process.platform === "win32" ? "bun.exe" : "bun",
	);
	if (existsSync(local)) return local;
	return "bun";
}

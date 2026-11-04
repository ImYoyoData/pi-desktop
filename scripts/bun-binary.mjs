import { existsSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const MIN_BINARY_BYTES = 5 * 1024 * 1024;

/**
 * bun 的 postinstall 执行后，平台二进制被搬到 node_modules/bun/bin，
 * @oven 包内只剩空 bin；未执行时二进制留在 @oven 包，bun/bin 里则是报错存根。
 * 用体积区分真实二进制与存根。
 */
function usable(candidate) {
	try {
		return statSync(candidate).size >= MIN_BINARY_BYTES;
	} catch {
		return false;
	}
}

/**
 * 定位 bun 可执行文件。
 *
 * 依次尝试 bun 包 bin、@oven 平台包，最后回退 PATH 里的 bun。
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
	const name = process.platform === "win32" ? "bun.exe" : "bun";
	const candidates = [
		path.join(root, "node_modules", "bun", "bin", name),
		path.join(root, "node_modules", `@oven/bun-${platform}-${arch}`, "bin", name),
	];
	for (const candidate of candidates) {
		if (usable(candidate)) return candidate;
	}
	return "bun";
}

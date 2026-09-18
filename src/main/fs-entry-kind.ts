import fs from "node:fs";

/**
 * Electron 的 asar 支持会把工作区里的 *.asar 当作虚拟目录打开并长期缓存句柄，
 * 导致构建产物（如 release/ 下的 asar）无法被覆盖或删除（EBUSY）。
 * 遍历工作区条目时关闭 asar，避免持有这些句柄。
 */
export function workspaceEntryKind(abs: string): "file" | "dir" | "none" {
	const prevNoAsar = process.noAsar;
	process.noAsar = true;
	try {
		const stat = fs.statSync(abs);
		if (stat.isFile()) return "file";
		return stat.isDirectory() ? "dir" : "none";
	} catch {
		return "none";
	} finally {
		process.noAsar = prevNoAsar;
	}
}

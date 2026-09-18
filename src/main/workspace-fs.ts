import fs from "node:fs";

/**
 * 工作区文件访问统一绕过 Electron 的 asar 层。
 *
 * Electron 把任意 *.asar 路径当成归档打开并长期缓存文件句柄：工作区里只要出现
 * 构建产物（如 release/win-unpacked/resources/app.asar），一次 stat/read 就足以让
 * 打包进程无法覆盖或删除它（EBUSY / EPERM）。读取失败不代表文件被删除。
 */
export function withoutAsar<T>(fn: () => T): T {
	const prev = process.noAsar;
	process.noAsar = true;
	try {
		return fn();
	} finally {
		process.noAsar = prev;
	}
}

/** 条目类型；不存在或读不到都算 "none"（仅用于展示与校验）。 */
export function workspaceEntryKind(abs: string): "file" | "dir" | "none" {
	try {
		const st = withoutAsar(() => fs.statSync(abs));
		if (st.isFile()) return "file";
		return st.isDirectory() ? "dir" : "none";
	} catch {
		return "none";
	}
}

/** 不存在返回 null；被占用、无权限等其它错误抛出，由调用方决定语义。 */
export function workspaceStat(abs: string): fs.Stats | null {
	return withoutAsar(() => {
		try {
			return fs.statSync(abs);
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "ENOENT" || code === "ENOTDIR") return null;
			throw err;
		}
	});
}

export function workspaceExists(abs: string): boolean {
	return withoutAsar(() => fs.existsSync(abs));
}

export function workspaceReadFile(abs: string): Buffer {
	return withoutAsar(() => fs.readFileSync(abs));
}

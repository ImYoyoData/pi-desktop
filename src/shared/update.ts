/** 版本号比较与更新元数据工具（共享，无 Node API）。 */

/** Parse `1.2.3` / `v1.2.3` into [major, minor, patch]. */
export function parseSemver(version: string): [number, number, number] | null {
	const m = String(version)
		.trim()
		.replace(/^v/i, "")
		.match(/^(\d+)\.(\d+)\.(\d+)/);
	if (!m) return null;
	return [Number(m[1]), Number(m[2]), Number(m[3])];
}

type ParsedVersion = {
	core: [number, number, number];
	/** 预发布标识符，如 `rc.2` → ["rc", "2"]。 */
	prerelease: string[];
};

/** 解析 `1.2.3-rc.1+build`，忽略构建元数据。 */
function parseVersion(version: string): ParsedVersion | null {
	const m = String(version)
		.trim()
		.replace(/^v/i, "")
		.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?/);
	if (!m) return null;
	return {
		core: [Number(m[1]), Number(m[2]), Number(m[3])],
		prerelease: m[4] ? m[4].split(".") : [],
	};
}

/** 比较单个预发布标识符：纯数字按数值比，其余按字典序比。 */
function comparePrereleaseId(a: string, b: string): number {
	const numA = /^\d+$/.test(a);
	const numB = /^\d+$/.test(b);
	if (numA && numB) {
		const diff = Number(a) - Number(b);
		return diff === 0 ? 0 : diff < 0 ? -1 : 1;
	}
	if (numA) return -1;
	if (numB) return 1;
	return a === b ? 0 : a < b ? -1 : 1;
}

/** 比较预发布部分：正式版高于同号预发布（1.0.0 > 1.0.0-rc.1）。 */
function comparePrerelease(a: string[], b: string[]): number {
	if (a.length === 0 && b.length === 0) return 0;
	if (a.length === 0) return 1;
	if (b.length === 0) return -1;
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		const diff = comparePrereleaseId(a[i]!, b[i]!);
		if (diff !== 0) return diff;
	}
	if (a.length === b.length) return 0;
	return a.length < b.length ? -1 : 1;
}

/** 版本比较：a 新于 b 返回 1，a 旧于 b 返回 -1，相等返回 0。 */
export function compareVersions(a: string, b: string): number {
	const pa = parseVersion(a);
	const pb = parseVersion(b);
	if (!pa || !pb) {
		const sa = String(a).trim().replace(/^v/i, "");
		const sb = String(b).trim().replace(/^v/i, "");
		return sa === sb ? 0 : sa < sb ? -1 : 1;
	}
	for (let i = 0; i < 3; i++) {
		if (pa.core[i]! > pb.core[i]!) return 1;
		if (pa.core[i]! < pb.core[i]!) return -1;
	}
	return comparePrerelease(pa.prerelease, pb.prerelease);
}

/** True when `latest` is strictly newer than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
	return compareVersions(latest, current) > 0;
}

/** 各平台安装包文件名后缀，与 electron-builder.yml 的 artifactName 对应。 */
const ASSET_SUFFIXES: Record<string, string[]> = {
	"win32-x64": ["-win-x64-setup.exe"],
	"win32-arm64": ["-win-arm64-setup.exe"],
	"darwin-arm64": ["-mac-arm64.dmg"],
	"darwin-x64": ["-mac-x64.dmg"],
	"linux-x64": ["-linux-x64.AppImage"],
	"linux-arm64": ["-linux-arm64.AppImage"],
};

/** 判断发布资源名是否是当前平台与架构的安装包。 */
export function matchUpdateAsset(
	fileName: string,
	platform: string,
	arch: string,
): boolean {
	const suffixes = ASSET_SUFFIXES[`${platform}-${arch}`];
	if (!suffixes) return false;
	return suffixes.some((suffix) => fileName.endsWith(suffix));
}

/**
 * 取安装包文件名：只保留最后一段，避免远端名称里的路径成分写到缓存目录之外。
 */
export function safeAssetFileName(fileName: string): string {
	const parts = String(fileName).split(/[\\/]/);
	return (parts[parts.length - 1] ?? "").trim();
}

/** 可安装的更新信息。 */
export type AppUpdateInfo = {
	/** 目标版本号（不含 v 前缀）。 */
	version: string;
	/** 安装包文件名。 */
	fileName: string;
	/** 安装包下载地址。 */
	downloadUrl: string;
	/** 对应的发布页地址。 */
	releaseUrl: string;
	/** 安装包字节数。 */
	size: number;
	/** 期望的 sha256 摘要（GitHub 资源 digest 字段），无则为 null。 */
	digest: string | null;
	/** 更新说明（Markdown 原文）。 */
	notes: string;
};

/** 下载阶段。 */
export type AppUpdatePhase = "downloading" | "done" | "error";

/** 下载进度事件。 */
export type AppUpdateProgress = {
	phase: AppUpdatePhase;
	/** 已下载百分比 0-100。 */
	percent: number;
	/** 已下载字节数。 */
	transferred: number;
	/** 总字节数。 */
	total: number;
	/** 当前速度（字节/秒）。 */
	bytesPerSecond: number;
	/** 失败原因（phase 为 error 时有值）。 */
	error?: string;
};

/** 更新状态机。 */
export type AppUpdateStatus =
	| "idle"
	| "checking"
	| "available"
	| "downloading"
	| "ready"
	| "error";

/** 主进程广播给渲染层的更新状态。 */
export type AppUpdateState = {
	status: AppUpdateStatus;
	info: AppUpdateInfo | null;
	progress: AppUpdateProgress | null;
	error: string | null;
};

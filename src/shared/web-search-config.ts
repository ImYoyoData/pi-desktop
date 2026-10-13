/**
 * 联网搜索工具（pi-web-access 扩展）的搜索服务器配置。
 * 这里只管理「复用 Pi 已登录 provider」一项，对应 web-search.json 里的
 * openaiSearchProviders / openaiUseProviderBaseUrl；其余字段（手填的凭据、
 * 服务地址、proxy 等）不在设置界面出现，读写时一律原样保留。
 */

/** 提供联网搜索能力的扩展；未安装时下方设置无处可用。 */
export const WEB_SEARCH_EXTENSION = "pi-web-access";

export type WebSearchSettings = {
	/** 复用提供商方案下选中的 Pi provider id（对应 openaiSearchProviders）。 */
	providerSource: string;
};

/** 读取配置 + 该扩展是否已安装，供设置界面提示。 */
export type WebSearchConfigState = {
	settings: WebSearchSettings;
	extensionInstalled: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(value: unknown): string {
	if (!Array.isArray(value)) return "";
	const first = value.find(
		(item): item is string => typeof item === "string" && !!item.trim(),
	);
	return first ? first.trim() : "";
}

/** 磁盘上的 web-search.json → 设置。 */
export function parseWebSearchSettings(raw: unknown): WebSearchSettings {
	const config = isRecord(raw) ? raw : {};
	return { providerSource: firstString(config.openaiSearchProviders) };
}

/** 把设置合并进原始配置：只覆盖被管理的字段，其余保持原样。 */
export function applyWebSearchSettings(
	raw: unknown,
	next: unknown,
): Record<string, unknown> {
	const config = isRecord(raw) ? { ...raw } : {};
	const input = isRecord(next) ? next : {};
	const providerSource =
		typeof input.providerSource === "string" ? input.providerSource.trim() : "";

	if (providerSource) {
		config.openaiSearchProviders = [providerSource];
		config.openaiUseProviderBaseUrl = true;
	} else {
		delete config.openaiSearchProviders;
		delete config.openaiUseProviderBaseUrl;
	}
	return config;
}

export function formatWebSearchConfig(config: Record<string, unknown>): string {
	return `${JSON.stringify(config, null, 2)}\n`;
}

/** 校验整份配置文本；交给用户的是失败原因而非异常。 */
export function readWebSearchConfigText(
	text: string,
): { ok: true; config: Record<string, unknown> } | { ok: false; error: string } {
	try {
		const raw: unknown = JSON.parse(text);
		if (!isRecord(raw)) return { ok: false, error: "must be a JSON object" };
		return { ok: true, config: raw };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}

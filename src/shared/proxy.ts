export type ProxyMode = "off" | "system" | "custom";

export type ProxySettings = {
	mode: ProxyMode;
	url: string;
};

export const DEFAULT_PROXY_SETTINGS: ProxySettings = {
	mode: "off",
	url: "",
};

export const PROXY_MODES: readonly ProxyMode[] = ["off", "system", "custom"];

const ALLOWED_PROTOCOLS = new Set([
	"http:",
	"https:",
	"socks4:",
	"socks5:",
	"socks:",
]);

export const PROXY_ENV_KEYS: readonly string[] = [
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"ALL_PROXY",
	"NO_PROXY",
	"http_proxy",
	"https_proxy",
	"all_proxy",
	"no_proxy",
];

export function normalizeProxyUrl(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
		? trimmed
		: `http://${trimmed}`;
	let parsed: URL;
	try {
		parsed = new URL(withScheme);
	} catch {
		return null;
	}
	if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;
	if (!parsed.hostname) return null;
	parsed.username = "";
	parsed.password = "";
	parsed.pathname = "";
	parsed.search = "";
	parsed.hash = "";
	const out = parsed.toString();
	return out.endsWith("/") ? out.slice(0, -1) : out;
}

/** Node 侧 fetch（EnvHttpProxyAgent）仅支持 http/https 代理，socks 需排除。 */
const NODE_PROXY_PROTOCOLS = /^(http:|https:)$/;

const NODE_NO_PROXY = "localhost,127.0.0.1,::1";

export function proxyEnvFromUrl(url: string): Record<string, string> {
	const normalized = normalizeProxyUrl(url);
	if (!normalized || !NODE_PROXY_PROTOCOLS.test(new URL(normalized).protocol))
		return {};
	return {
		HTTP_PROXY: normalized,
		HTTPS_PROXY: normalized,
		ALL_PROXY: normalized,
		http_proxy: normalized,
		https_proxy: normalized,
		all_proxy: normalized,
		NO_PROXY: NODE_NO_PROXY,
		no_proxy: NODE_NO_PROXY,
	};
}

/** Parse a `session.resolveProxy` result like "PROXY host:port; DIRECT".
 *  Prefer HTTP(S) entries — Node-side fetch cannot use SOCKS proxies. */
export function proxyEnvFromPacResult(
	pacResult: string,
): Record<string, string> {
	const schemeByToken: Record<string, string> = {
		proxy: "http",
		https: "https",
		socks: "socks5",
		socks4: "socks4",
		socks5: "socks5",
	};
	for (const entry of pacResult.split(";")) {
		const match = /^(PROXY|HTTPS|SOCKS|SOCKS4|SOCKS5)\s+(\S+)$/i.exec(
			entry.trim(),
		);
		if (!match) continue;
		const scheme = schemeByToken[match[1].toLowerCase()];
		if (scheme && NODE_PROXY_PROTOCOLS.test(`${scheme}:`)) {
			return proxyEnvFromUrl(`${scheme}://${match[2]}`);
		}
	}
	return {};
}

export function isProxyActive(settings: ProxySettings): boolean {
	if (settings.mode === "system") return true;
	if (settings.mode === "custom")
		return normalizeProxyUrl(settings.url) !== null;
	return false;
}

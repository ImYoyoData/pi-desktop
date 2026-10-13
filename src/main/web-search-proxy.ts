import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { normalizeProxyUrl, type ProxySettings } from "../shared/proxy";

const CONFIG_FILE = "web-search.json";

/** 与 pi-web-access 的 getWebSearchConfigDir 保持一致，否则写入的文件不会被读取。 */
export function webSearchConfigPath(): string {
	const explicitDir = process.env.PI_CODING_AGENT_DIR;
	if (explicitDir) return join(explicitDir, CONFIG_FILE);

	const xdgConfigHome = process.env.XDG_CONFIG_HOME;
	if (xdgConfigHome) {
		const xdgDir = join(xdgConfigHome, "pi");
		if (existsSync(join(xdgDir, CONFIG_FILE))) return join(xdgDir, CONFIG_FILE);
		const legacyDir = join(homedir(), ".pi");
		if (existsSync(join(legacyDir, CONFIG_FILE)))
			return join(legacyDir, CONFIG_FILE);
		return join(xdgDir, CONFIG_FILE);
	}

	const agentDir = join(homedir(), ".pi", "agent");
	if (existsSync(join(agentDir, CONFIG_FILE)))
		return join(agentDir, CONFIG_FILE);
	const legacyDir = join(homedir(), ".pi");
	if (existsSync(join(legacyDir, CONFIG_FILE)))
		return join(legacyDir, CONFIG_FILE);
	return join(agentDir, CONFIG_FILE);
}

/** pi-web-access 只认 web-search.json 的 proxy 字段，不读环境变量，故需把
 *  desktop 的代理设置同步过去；其余字段（API key 等）原样保留。 */
function readConfig(path: string): Record<string, unknown> {
	try {
		const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (raw && typeof raw === "object" && !Array.isArray(raw))
			return raw as Record<string, unknown>;
	} catch {
		// 文件缺失或损坏：pi 侧本就无法读取，重建为空配置
	}
	return {};
}

function writeConfig(path: string, config: Record<string, unknown>): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
}

function resolveProxyUrl(
	settings: ProxySettings,
	systemProxyUrl: string | undefined,
): string | null {
	if (settings.mode === "custom") return normalizeProxyUrl(settings.url);
	if (settings.mode === "system") return normalizeProxyUrl(systemProxyUrl ?? "");
	return null;
}

export function syncWebSearchProxy(
	settings: ProxySettings,
	systemProxyUrl: string | undefined,
): void {
	const path = webSearchConfigPath();
	const proxy = resolveProxyUrl(settings, systemProxyUrl);

	const config = readConfig(path);
	if (proxy === null) {
		if (!("proxy" in config)) return;
		delete config.proxy;
	} else {
		config.proxy = proxy;
	}
	writeConfig(path, config);
}

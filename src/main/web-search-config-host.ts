/** 读写 pi-web-access 扩展的 web-search.json；proxy 字段仍由 proxy-host 维护。 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { webSearchConfigPath } from "./web-search-proxy";
import {
	agentNpmExtensionDir,
	listAgentNpmExtensions,
} from "./agent-npm-extensions";
import {
	applyWebSearchSettings,
	formatWebSearchConfig,
	parseWebSearchSettings,
	readWebSearchConfigText,
	WEB_SEARCH_EXTENSION,
	type WebSearchConfigState,
} from "../shared/web-search-config";

function readConfig(): Record<string, unknown> {
	try {
		const result = readWebSearchConfigText(readFileSync(webSearchConfigPath(), "utf8"));
		return result.ok ? result.config : {};
	} catch {
		// 首次使用还没有这个文件：按空配置起手
		return {};
	}
}

function writeConfig(config: Record<string, unknown>): void {
	const file = webSearchConfigPath();
	mkdirSync(dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(tmp, formatWebSearchConfig(config), { encoding: "utf8", mode: 0o600 });
	renameSync(tmp, file);
}

/** 扩展是否就位：npm deps 记录与实际安装目录任一命中即可，
 *  这样 git 源安装（只落在目录里）也能被识别。 */
function isExtensionInstalled(): boolean {
	if (listAgentNpmExtensions().some((item) => item.name === WEB_SEARCH_EXTENSION))
		return true;
	return existsSync(agentNpmExtensionDir(WEB_SEARCH_EXTENSION));
}

export function getWebSearchConfig(): WebSearchConfigState {
	return {
		settings: parseWebSearchSettings(readConfig()),
		extensionInstalled: isExtensionInstalled(),
	};
}

export function setWebSearchSettings(next: unknown): WebSearchConfigState {
	const config = applyWebSearchSettings(readConfig(), next);
	writeConfig(config);
	return {
		settings: parseWebSearchSettings(config),
		extensionInstalled: isExtensionInstalled(),
	};
}
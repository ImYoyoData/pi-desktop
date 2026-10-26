/**
 * 内置浏览器设置（desktop-prefs.json 的 browser:* 键）。
 * 渲染端直接读写 prefs，worker 在每回合前读同一份文件判断工具开关。
 */

/** 桌面偏好文件名，与 main/prefs-store.ts 保持同一份。 */
export const DESKTOP_PREFS_FILENAME = "desktop-prefs.json";

export const BROWSER_TOOL_MODES = ["auto", "always", "off"] as const;
export type BrowserToolMode = (typeof BROWSER_TOOL_MODES)[number];

export const BROWSER_TOOL_MODE_PREF = "browser:toolMode";
export const BROWSER_NEW_TAB_URL_PREF = "browser:newTabUrl";
export const BROWSER_RECORD_HISTORY_PREF = "browser:recordHistory";

export type BrowserSettings = {
	/** browser_* 工具何时交给模型。 */
	toolMode: BrowserToolMode;
	/** 新标签页默认地址；空字符串表示空白页。 */
	newTabUrl: string;
	/** 是否记录浏览历史。 */
	recordHistory: boolean;
};

export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
	toolMode: "auto",
	newTabUrl: "",
	recordHistory: true,
};

function isToolMode(value: unknown): value is BrowserToolMode {
	return BROWSER_TOOL_MODES.includes(value as BrowserToolMode);
}

/** 只接受 http(s) 地址，非法输入回落空白页。 */
export function normalizeNewTabUrl(raw: unknown): string {
	const text = typeof raw === "string" ? raw.trim() : "";
	if (!text) return "";
	return /^https?:\/\/\S+$/i.test(text) ? text : "";
}

export function parseBrowserSettings(prefs: Record<string, string | undefined>): BrowserSettings {
	const mode = prefs[BROWSER_TOOL_MODE_PREF];
	return {
		toolMode: isToolMode(mode) ? mode : DEFAULT_BROWSER_SETTINGS.toolMode,
		newTabUrl: normalizeNewTabUrl(prefs[BROWSER_NEW_TAB_URL_PREF]),
		recordHistory: prefs[BROWSER_RECORD_HISTORY_PREF] !== "false",
	};
}

/** 写回 prefs 的 patch。 */
export function browserPrefsPatch(settings: BrowserSettings): Record<string, string> {
	return {
		[BROWSER_TOOL_MODE_PREF]: settings.toolMode,
		[BROWSER_NEW_TAB_URL_PREF]: settings.newTabUrl,
		[BROWSER_RECORD_HISTORY_PREF]: settings.recordHistory ? "true" : "false",
	};
}

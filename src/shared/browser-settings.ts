/**
 * 内置浏览器设置（desktop-prefs.json 的 browser:* 键）。
 * 渲染端直接读写 prefs，worker 在每回合前读同一份文件判断工具开关。
 */

/** 桌面偏好文件名，与 main/prefs-store.ts 保持同一份。 */
export const DESKTOP_PREFS_FILENAME = "desktop-prefs.json";

export const BROWSER_TOOL_MODES = ["auto", "always", "off"] as const;
export type BrowserToolMode = (typeof BROWSER_TOOL_MODES)[number];

export const BROWSER_TOOL_MODE_PREF = "browser:toolMode";

export type BrowserSettings = {
	/** browser_* 工具何时交给模型。 */
	toolMode: BrowserToolMode;
};

export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
	toolMode: "auto",
};

function isToolMode(value: unknown): value is BrowserToolMode {
	return BROWSER_TOOL_MODES.includes(value as BrowserToolMode);
}

export function parseBrowserSettings(prefs: Record<string, string | undefined>): BrowserSettings {
	const mode = prefs[BROWSER_TOOL_MODE_PREF];
	return { toolMode: isToolMode(mode) ? mode : DEFAULT_BROWSER_SETTINGS.toolMode };
}

/** 写回 prefs 的 patch。 */
export function browserPrefsPatch(settings: BrowserSettings): Record<string, string> {
	return { [BROWSER_TOOL_MODE_PREF]: settings.toolMode };
}

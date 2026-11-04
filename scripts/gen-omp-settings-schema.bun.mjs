import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 从 omp SDK 导出设置面板的元数据，写成桌面端可用的 JSON。
 *
 * 桌面主进程不能 import omp SDK（它依赖 bun 运行时），所以把 omp 自己的
 * tab / group / 字段元数据在构建期抽出来随包分发；omp 升级后重跑本脚本即可。
 *
 * 由 scripts/gen-omp-settings-schema.mjs 调用（它负责定位 bun）。
 */
const root = path.resolve(import.meta.dirname, "..");
const pkgFile = (relative) =>
	pathToFileURL(path.join(root, "node_modules", relative)).href;

const { orderedSettings } = await import(
	pkgFile("@oh-my-pi/pi-coding-agent/src/config/all-settings.ts")
);
const { SETTING_TABS, TAB_GROUPS, TAB_METADATA, TAB_LEADS } = await import(
	pkgFile("@oh-my-pi/pi-tui/src/overlays/settings-defs.ts")
);
const { VERSION } = await import(pkgFile("@oh-my-pi/pi-utils/src/dirs.ts"));

/**
 * 只影响 omp 终端界面（主题、输入框、状态栏、终端标题、滚动回放……）的设置。
 *
 * 桌面端有自己的一套渲染与输入，这些项改了在应用里看不到任何变化，
 * 摆出来只会让设置页变成没人能验证的开关墙，直接不导出。
 */
const TUI_ONLY_PREFIXES = [
	"tui.",
	"terminal.",
	"display.",
	"statusLine.",
	"composer.",
	"theme.",
];

const TUI_ONLY_IDS = new Set([
	"symbolPreset",
	"colorBlindMode",
	"showHardwareCursor",
	"title.icons",
	"task.showResolvedModelBadge",
	"hideThinkingBlock",
	"expandThinkingBlocks",
	"proseOnlyThinking",
	"goal.statusInFooter",
	"async.widgets",
	"extensionRenderers.assistantText",
	"spelling.typoDetection",
	"spelling.autocomplete",
	"spelling.autocorrect",
	"emojiAutocomplete",
	"autocompleteMaxVisible",
	"paste.largeMenuThreshold",
	"doubleEscapeAction",
	"input.bareExitOnEmptySession",
	"treeFilterMode",
	"startup.quiet",
	"startup.showSplash",
	"startup.setupWizard",
	"startup.changelogMode",
	"startup.checkUpdate",
	"update.channel",
	"marketplace.autoUpdate",
	"completion.notify",
	"error.notify",
]);

/**
 * 桌面端没有对应能力栈的功能开关（语音、协作推流、CLI 启动行为）。
 *
 * 这些不是渲染问题，而是桌面端根本不跑那条链路，改了也不会有任何反馈。
 */
const DESKTOP_UNAVAILABLE_IDS = new Set([
	"autoResume",
	"stt.enabled",
	"stt.submitTrigger",
	"speech.enabled",
	"speech.mode",
	"speech.enhanced",
	"speech.voice",
	"speech.speed",
	"tts.localVoice",
	"tts.localSpeed",
	"live.voice",
	"collab.relayUrl",
	"collab.webUrl",
	"collab.displayName",
	"collab.autoStart",
	"share.serverUrl",
	"share.store",
	"share.redactSecrets",
	"stream.serverUrl",
	"stream.redactPatterns",
]);

/** 桌面端仍适用但归类更贴切的项（主题页删掉后图片项落到视觉组）。 */
const DESKTOP_OVERRIDES = {
	"images.autoResize": { tab: "model", group: "Vision" },
	"images.blockImages": { tab: "model", group: "Vision" },
};

function isTuiOnly(id) {
	if (TUI_ONLY_IDS.has(id)) return true;
	return TUI_ONLY_PREFIXES.some((prefix) => id.startsWith(prefix));
}

function isDesktopUnavailable(id) {
	return DESKTOP_UNAVAILABLE_IDS.has(id);
}

/** 选项文案：omp 用 SubmenuOption 给出 label/description，比裸值好用。 */
function optionsOf(setting) {
	const options = setting.ui?.options;
	if (!Array.isArray(options)) return null;
	return options.map((option) => ({
		value: option.value,
		label: option.label,
		description: option.description ?? null,
	}));
}

/** 条件显示：ui.condition 是 omp 内部的条件名，桌面端按同名判定。 */
const conditions = [];
for (const setting of orderedSettings()) {
	if (isTuiOnly(setting.id)) continue;
	if (isDesktopUnavailable(setting.id)) continue;
	const condition = setting.ui?.condition;
	if (!condition || conditions.includes(condition)) continue;
	conditions.push(condition);
}

const settings = [];
for (const setting of orderedSettings()) {
	const ui = setting.ui;
	if (!ui?.tab) continue;
	if (setting.type === "record") continue;
	if (isTuiOnly(setting.id)) continue;
	if (isDesktopUnavailable(setting.id)) continue;
	const override = DESKTOP_OVERRIDES[setting.id];
	settings.push({
		id: setting.id,
		tab: override?.tab ?? ui.tab,
		group: override?.group ?? ui.group ?? null,
		type: setting.type,
		label: ui.label,
		description: ui.description,
		warning: ui.warning ?? null,
		condition: ui.condition ?? null,
		secret: ui.secret === true,
		credential: setting.isCredential,
		/** 未设置时的取值；界面用它显示「默认」并提供恢复默认。 */
		default:
			setting.type === "array" || setting.type === "record"
				? null
				: setting.default ?? null,
		/** 枚举/数组的可选值。 */
		values:
			setting.type === "enum"
				? [...(setting.enumValues ?? [])]
				: setting.type === "array"
					? [...(setting.definition.items?.values ?? [])]
					: null,
		options: optionsOf(setting),
		env: setting.envName ?? null,
	});
}

const tabs = SETTING_TABS.filter((id) =>
	settings.some((setting) => setting.tab === id),
).map((id) => {
	const groups = [...TAB_GROUPS[id]].filter((group) =>
		settings.some((setting) => setting.tab === id && setting.group === group),
	);
	return {
		id,
		label: TAB_METADATA[id].label,
		lead: TAB_LEADS[id],
		groups,
	};
});

const out = {
	schemaVersion: 3,
	ompVersion: VERSION,
	tabs,
	conditions,
	settings,
};

const outFile = path.join(root, "src", "shared", "omp-settings-schema.json");
fs.writeFileSync(outFile, `${JSON.stringify(out, null, "\t")}\n`, "utf8");
console.info(
	`[omp-settings] ${settings.length} settings, ${tabs.length} tabs, ${conditions.length} conditions → ${path.relative(root, outFile)}`,
);

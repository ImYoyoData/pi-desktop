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
	const condition = setting.ui?.condition;
	if (!condition || conditions.includes(condition)) continue;
	conditions.push(condition);
}

const settings = [];
for (const setting of orderedSettings()) {
	const ui = setting.ui;
	if (!ui?.tab) continue;
	if (setting.type === "record") continue;
	settings.push({
		id: setting.id,
		tab: ui.tab,
		group: ui.group ?? null,
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

const tabs = SETTING_TABS.map((id) => ({
	id,
	label: TAB_METADATA[id].label,
	lead: TAB_LEADS[id],
	groups: [...TAB_GROUPS[id]],
}));

const out = {
	schemaVersion: 2,
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

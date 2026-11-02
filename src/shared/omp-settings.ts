import rawSchema from "./omp-settings-schema.json";

/**
 * omp 设置面板的 schema（由 scripts/gen-omp-settings-schema.mjs 从 omp SDK 导出）。
 *
 * 桌面端不 import omp SDK，只按这份元数据渲染表单；实际值仍写在
 * ~/.omp/agent/config.yml 里，由主进程读写。
 */

export type OmpSettingType = "boolean" | "string" | "number" | "enum" | "array";

/** 选项文案：omp 的 SubmenuOption。 */
export type OmpSettingOption = {
	value: string;
	label: string;
	description: string | null;
};

export type OmpSettingEntry = {
	id: string;
	tab: string;
	group: string | null;
	type: OmpSettingType;
	label: string;
	description: string;
	warning: string | null;
	/** omp 的条件显示名；为空表示始终显示。 */
	condition: string | null;
	secret: boolean;
	credential: boolean;
	/** 未设置时的取值（null 表示该类型没有默认值）。 */
	default: unknown;
	/** 枚举/数组的可选值。 */
	values: string[] | null;
	options: OmpSettingOption[] | null;
	env: string | null;
};

export type OmpSettingsTabEntry = {
	id: string;
	label: string;
	lead: string;
	groups: string[];
};

/** 设置页一次读取的全部内容：配置文件位置与已显式设置的值。 */
export type OmpSettingsSnapshot = {
	filePath: string;
	exists: boolean;
	values: Record<string, unknown>;
};

type OmpSettingsSchemaFile = {
	schemaVersion: number;
	ompVersion: string;
	tabs: OmpSettingsTabEntry[];
	conditions: string[];
	settings: OmpSettingEntry[];
};

const schema = rawSchema as OmpSettingsSchemaFile;

export const OMP_SETTINGS_TABS: readonly OmpSettingsTabEntry[] = schema.tabs;
export const OMP_SETTINGS: readonly OmpSettingEntry[] = schema.settings;

export function ompSettingsForTab(tab: string): OmpSettingEntry[] {
	return schema.settings.filter((entry) => entry.tab === tab);
}

/** 设置 id 是点分路径；逐层读到目标值，缺失返回 undefined。 */
export function readOmpSetting(root: unknown, id: string): unknown {
	let cursor: unknown = root;
	for (const segment of id.split(".")) {
		if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
			return undefined;
		}
		cursor = (cursor as Record<string, unknown>)[segment];
	}
	return cursor;
}

/**
 * 写入一个设置。`value` 为 undefined / null 时删除该键，并在父节点因此变空时
 * 一并删掉父节点，避免留下 `theme: {}` 这类空壳。
 */
export function writeOmpSetting(
	root: Record<string, unknown>,
	id: string,
	value: unknown,
): void {
	const segments = id.split(".");
	const parents: Record<string, unknown>[] = [root];
	let cursor = root;
	for (const segment of segments.slice(0, -1)) {
		const next = cursor[segment];
		if (!next || typeof next !== "object" || Array.isArray(next)) {
			if (value === undefined || value === null) return;
			const created: Record<string, unknown> = {};
			cursor[segment] = created;
			cursor = created;
		} else {
			cursor = next as Record<string, unknown>;
		}
		parents.push(cursor);
	}
	const leaf = segments[segments.length - 1]!;
	if (value === undefined || value === null) {
		delete cursor[leaf];
		for (let i = parents.length - 1; i > 0; i--) {
			const node = parents[i]!;
			if (Object.keys(node).length > 0) break;
			const parent = parents[i - 1]!;
			delete parent[segments[i - 1]!];
		}
		return;
	}
	cursor[leaf] = value;
}

/** 设置的实际生效值：已设置的值优先，否则取 schema 里的默认值。 */
export function ompEffectiveValue(
	entry: OmpSettingEntry,
	values: Record<string, unknown>,
): unknown {
	if (Object.prototype.hasOwnProperty.call(values, entry.id)) {
		return values[entry.id];
	}
	return entry.default;
}

/**
 * 条件显示判定。
 *
 * omp 的条件名是内部符号（见 omp 的 config/settings-ui.ts），桌面端按同样的
 * 依据换算：多数条件等价于另一个设置项的取值。
 */
export function ompSettingVisible(
	entry: OmpSettingEntry,
	values: Record<string, unknown>,
): boolean {
	if (!entry.condition) return true;
	// 条件多等价于另一个设置项的取值；那个设置项自己的默认值也算数。
	const value = (id: string): unknown => {
		const target = OMP_SETTINGS.find((item) => item.id === id);
		return target ? ompEffectiveValue(target, values) : undefined;
	};
	switch (entry.condition) {
		case "macOS":
			// 桌面端不跑终端渲染：macOS 专属项（拼写检查等）在桌面端没有意义。
			return false;
		case "hasImageProtocol":
		case "nativeRendering":
			// 终端能力，桌面端恒为真。
			return true;
		case "advisorEnabled":
			return value("advisor.enabled") === true;
		case "vimModeEnabled":
			return value("tui.vimMode") === true;
		case "hindsightActive":
			return value("memory.backend") === "hindsight";
		case "mnemopiActive":
			return value("memory.backend") === "mnemopi";
		case "autolearnActive":
			return value("autolearn.enabled") === true;
		case "autoThinkingActive":
			return value("defaultThinkingLevel") === "auto";
		case "usageAwareFallbackEnabled":
			return value("retry.usageAwareFallback") === true;
		case "planModeEnabled":
			return value("plan.enabled") === true;
		case "planAutosaveEnabled":
			return value("plan.enabled") === true && value("plan.autosave") === true;
		default:
			// 其余条件（层归属类）在桌面端无法判定，按显示处理。
			return true;
	}
}

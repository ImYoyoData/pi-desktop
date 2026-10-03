/**
 * 内置工具开关（settings.json 的 defaultTools）与 codemode 设置的读写。
 *
 * codemode / tool_search 在 pi 里默认不激活，pi 也没有对应的 SettingsManager
 * setter，因此开关只改全局 settings.json；解析规则与 pi settings-manager 的
 * mergeDefaultTools / resolveDefaultTools 保持一致。
 */

import type { BuiltinToolItem, CodemodeSettingsState } from "../shared/customizations";
import { readSettingsRoot, settingsPath, updateSettingsRoot } from "./settings-file";

type SettingsLike = {
	getGlobalSettings: () => { defaultTools?: unknown; codemode?: unknown };
	getProjectSettings: () => { defaultTools?: unknown; codemode?: unknown };
};

/** pi 的 DEFAULT_TOOL_NAMES：defaultTools 没写普通工具名时启用的工具。 */
const DEFAULT_TOOL_NAMES = ["read", "bash", "edit", "write"];

/** 桌面可切换的内置工具（pi 里默认不激活）。 */
export const BUILTIN_TOOL_NAMES = ["codemode", "tool_search"] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isToolModifier(entry: string): boolean {
	return entry.startsWith("+") || entry.startsWith("-");
}

/** 项目层只写 +name/-name 时追加到全局选择，否则整段替换（与 pi 一致）。 */
function mergeDefaultTools(base: string[], overrides: string[]): string[] {
	if (overrides.length === 0) return base;
	if (!overrides.every(isToolModifier)) return overrides;
	return [...base, ...overrides];
}

/** 普通工具名替换默认集，再按顺序应用 +name / -name（与 pi 一致）。 */
function resolveDefaultTools(entries: string[]): string[] {
	const plain = entries.filter((entry) => !isToolModifier(entry));
	const tools = plain.length > 0 || entries.length === 0 ? [...plain] : [...DEFAULT_TOOL_NAMES];
	for (const entry of entries) {
		if (!isToolModifier(entry)) continue;
		const name = entry.slice(1);
		const index = tools.indexOf(name);
		if (entry.startsWith("+") && index === -1 && name) tools.push(name);
		else if (entry.startsWith("-") && index !== -1) tools.splice(index, 1);
	}
	return tools;
}

function toolEntries(value: unknown): string[] {
	return isStringArray(value) ? value : [];
}

/** 开关状态：合并后是否启用；项目层改变了该工具状态时标记为项目覆盖。 */
export function builtinToolItems(settings: SettingsLike): BuiltinToolItem[] {
	const globalEntries = toolEntries(settings.getGlobalSettings().defaultTools);
	const projectEntries = toolEntries(settings.getProjectSettings().defaultTools);
	const globalTools = resolveDefaultTools(globalEntries);
	const mergedTools = resolveDefaultTools(mergeDefaultTools(globalEntries, projectEntries));
	return BUILTIN_TOOL_NAMES.map((name) => ({
		id: name,
		name,
		enabled: mergedTools.includes(name),
		overridden:
			projectEntries.length > 0 &&
			globalTools.includes(name) !== mergedTools.includes(name),
	}));
}

function readCodemode(value: unknown): { mode?: unknown; inlineBudget?: unknown } {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as { mode?: unknown; inlineBudget?: unknown })
		: {};
}

/** 全局与项目层字段级合并后的 codemode 设置。 */
export function codemodeSettingsState(settings: SettingsLike): CodemodeSettingsState {
	const global = readCodemode(settings.getGlobalSettings().codemode);
	const project = readCodemode(settings.getProjectSettings().codemode);
	const mode = project.mode ?? global.mode;
	const budget = project.inlineBudget ?? global.inlineBudget;
	return {
		mode: mode === "only" ? "only" : "on",
		...(typeof budget === "number" && Number.isFinite(budget) && budget >= 0
			? { inlineBudget: budget }
			: {}),
	};
}

async function settingsManagerFor(cwd: string | undefined) {
	const sdk = await import("@earendil-works/pi-coding-agent");
	return sdk.SettingsManager.create(cwd ?? process.cwd(), sdk.getAgentDir(), {
		projectTrusted: true,
	});
}

/** 切换 codemode / tool_search：在全局 defaultTools 里加 `+name` / `-name`。 */
export async function setBuiltinToolEnabled(
	name: string,
	enabled: boolean,
	cwd?: string,
): Promise<BuiltinToolItem[]> {
	if (!(BUILTIN_TOOL_NAMES as readonly string[]).includes(name)) {
		throw new Error(`Unknown built-in tool "${name}"`);
	}
	const filePath = settingsPath();
	const root = readSettingsRoot(filePath);
	const current = toolEntries(root.defaultTools);
	const next = current.filter((entry) => entry !== `+${name}` && entry !== `-${name}`);
	next.push(enabled ? `+${name}` : `-${name}`);
	await updateSettingsRoot({ defaultTools: next.length > 0 ? next : undefined });
	return builtinToolItems(await settingsManagerFor(cwd));
}

/** 写 codemode 段；`inlineBudget: null` 清除该键，回到 pi 默认值。 */
export async function setCodemodeSettings(
	patch: { mode?: unknown; inlineBudget?: unknown },
	cwd?: string,
): Promise<CodemodeSettingsState> {
	const filePath = settingsPath();
	const root = readSettingsRoot(filePath);
	const current = readCodemode(root.codemode);
	const next: Record<string, unknown> = { ...current };
	if (patch.mode !== undefined) {
		if (patch.mode !== "on" && patch.mode !== "only") {
			throw new Error("codemode.mode must be \"on\" or \"only\"");
		}
		next.mode = patch.mode;
	}
	if (patch.inlineBudget !== undefined) {
		if (patch.inlineBudget === null) {
			delete next.inlineBudget;
		} else if (
			typeof patch.inlineBudget !== "number" ||
			!Number.isFinite(patch.inlineBudget) ||
			patch.inlineBudget < 0
		) {
			throw new Error("codemode.inlineBudget must be a non-negative number");
		} else {
			next.inlineBudget = Math.round(patch.inlineBudget);
		}
	}
	await updateSettingsRoot({
		codemode: Object.keys(next).length > 0 ? next : undefined,
	});
	return codemodeSettingsState(await settingsManagerFor(cwd));
}

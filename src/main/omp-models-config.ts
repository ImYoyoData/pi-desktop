import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { ompAgentDir } from "./omp-dir";
import { writeYamlObject } from "./omp-yaml";
import type {
	OmpModelRow,
	OmpModelsSnapshot,
	OmpProviderRow,
} from "../shared/omp-models";
import {
	THINKING_LEVELS,
	type ThinkingLevel,
} from "../shared/thinking-level";

export function ompModelsPath(): string {
	return path.join(ompAgentDir(), "models.yml");
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

/** models.yml 的 thinking 用 efforts，也可能用旧的 levels / minLevel+maxLevel。 */
function readThinkingEfforts(raw: unknown): ThinkingLevel[] | null {
	const thinking = asRecord(raw);
	if (!thinking) return null;
	const declared = Array.isArray(thinking.efforts)
		? thinking.efforts
		: Array.isArray(thinking.levels)
			? thinking.levels
			: levelRange(thinking.minLevel, thinking.maxLevel);
	return THINKING_LEVELS.filter(
		({ value }) => value !== "off" && declared.includes(value),
	).map(({ value }) => value);
}

function levelRange(min: unknown, max: unknown): string[] {
	const from =
		typeof min === "string"
			? THINKING_LEVELS.findIndex(({ value }) => value === min)
			: -1;
	const to =
		typeof max === "string"
			? THINKING_LEVELS.findIndex(({ value }) => value === max)
			: -1;
	if (from < 0 || to < 0) return [];
	return THINKING_LEVELS.slice(from, Math.max(from, to) + 1).map(
		({ value }) => value,
	);
}

/** 只改页面上的思考档位：null 保留文件原值，空数组删掉 thinking。 */
function applyThinking(
	model: Record<string, unknown>,
	previous: Record<string, unknown>,
	efforts: ThinkingLevel[] | null,
): void {
	if (efforts === null) return;
	if (efforts.length === 0) {
		delete model.thinking;
		return;
	}
	const previousThinking = asRecord(previous.thinking) ?? {};
	const mode =
		typeof previousThinking.mode === "string" ? previousThinking.mode : "effort";
	const thinking: Record<string, unknown> = {
		...previousThinking,
		mode,
		efforts: [...efforts],
	};
	delete thinking.levels;
	delete thinking.minLevel;
	delete thinking.maxLevel;
	model.thinking = thinking;
}

function providerRows(doc: unknown): OmpProviderRow[] {
	const providers = asRecord(asRecord(doc)?.providers);
	if (!providers) return [];
	const rows: OmpProviderRow[] = [];
	for (const [id, raw] of Object.entries(providers)) {
		const provider = asRecord(raw) ?? {};
		const models = Array.isArray(provider.models) ? provider.models : [];
		rows.push({
			id,
			api: typeof provider.api === "string" ? provider.api : "",
			baseUrl: typeof provider.baseUrl === "string" ? provider.baseUrl : "",
			apiKey: typeof provider.apiKey === "string" ? provider.apiKey : "",
			models: models
				.map(asRecord)
				.filter((m): m is Record<string, unknown> => m !== null)
				.map((m) => {
					const input = Array.isArray(m.input) ? m.input : [];
					return {
						id: typeof m.id === "string" ? m.id : "",
						name: typeof m.name === "string" ? m.name : "",
						api: typeof m.api === "string" ? m.api : "",
						contextWindow:
							typeof m.contextWindow === "number" ? m.contextWindow : null,
						maxTokens: typeof m.maxTokens === "number" ? m.maxTokens : null,
						reasoning: m.reasoning === true,
						thinkingEfforts: readThinkingEfforts(m.thinking),
						vision: input.includes("image"),
					};
				})
				.filter((m) => m.id),
		});
	}
	return rows;
}

export function readOmpModels(): OmpModelsSnapshot {
	const filePath = ompModelsPath();
	if (!fs.existsSync(filePath)) {
		return { providers: [] };
	}
	try {
		return { providers: providerRows(loadYaml(fs.readFileSync(filePath, "utf8"))) };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`failed to read ${filePath}: ${message}`);
	}
}

function put(target: Record<string, unknown>, key: string, value: unknown): void {
	if (value === "" || value === null || value === undefined) delete target[key];
	else target[key] = value;
}

function modelPlain(
	row: OmpModelRow,
	previous: Record<string, unknown>,
): Record<string, unknown> {
	const model = { ...previous };
	model.id = row.id;
	put(model, "name", row.name.trim());
	put(model, "api", row.api.trim());
	put(model, "contextWindow", row.contextWindow);
	put(model, "maxTokens", row.maxTokens);
	put(model, "reasoning", row.reasoning ? true : null);
	put(model, "input", row.vision ? ["text", "image"] : null);
	applyThinking(model, previous, row.thinkingEfforts);
	return model;
}

/** 保存前的行校验：空 id 会被静默丢弃，重复 id 会互相覆盖，都必须拦下来。 */
function assertModelRows(providers: OmpProviderRow[]): void {
	const providerIds = new Set<string>();
	for (const row of providers) {
		const id = row.id.trim();
		if (!id) throw new Error("供应商 id 不能为空");
		if (providerIds.has(id)) throw new Error(`供应商 id 重复：${id}`);
		providerIds.add(id);
		const modelIds = new Set<string>();
		for (const model of row.models) {
			const modelId = model.id.trim();
			if (!modelId) throw new Error(`供应商 ${id} 下有未填写 id 的模型`);
			if (modelIds.has(modelId)) {
				throw new Error(`供应商 ${id} 的模型 id 重复：${modelId}`);
			}
			modelIds.add(modelId);
		}
	}
}

/**
 * 把设置页的编辑合并回 models.yml。
 *
 * 只改页面上的字段，供应商与模型上其它 omp 字段（cost/thinking/compat/…）
 * 按原样保留；删除的供应商/模型随整份列表一起消失。
 * shortcut: js-yaml 往返会丢注释，保存前留一份 models.yml.bak。
 */
export function saveOmpModels(providers: OmpProviderRow[]): OmpModelsSnapshot {
	assertModelRows(providers);
	const filePath = ompModelsPath();
	const previous = fs.existsSync(filePath)
		? asRecord(loadYaml(fs.readFileSync(filePath, "utf8"))) ?? {}
		: {};
	const root: Record<string, unknown> = { ...previous };
	const previousProviders = asRecord(root.providers) ?? {};

	const nextProviders: Record<string, unknown> = {};
	for (const row of providers) {
		const id = row.id.trim();
		if (!id) continue;
		const existing = asRecord(previousProviders[id]) ?? {};
		const provider: Record<string, unknown> = { ...existing };
		put(provider, "api", row.api.trim());
		put(provider, "baseUrl", row.baseUrl.trim());
		put(provider, "apiKey", row.apiKey.trim());
		const previousModels = Array.isArray(provider.models) ? provider.models : [];
		const byId = new Map<string, Record<string, unknown>>();
		for (const model of previousModels) {
			const record = asRecord(model);
			if (record && typeof record.id === "string") byId.set(record.id, record);
		}
		const models = row.models
			.filter((model) => model.id.trim())
			.map((model) => {
				const prev = byId.get(model.id.trim()) ?? {};
				return modelPlain({ ...model, id: model.id.trim() }, prev);
			});
		put(provider, "models", models.length ? models : null);
		nextProviders[id] = provider;
	}
	root.providers = nextProviders;
	writeYamlObject(filePath, root);
	return readOmpModels();
}

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

export function ompModelsPath(): string {
	return path.join(ompAgentDir(), "models.yml");
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
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
	return model;
}

/**
 * 把设置页的编辑合并回 models.yml。
 *
 * 只改页面上的字段，供应商与模型上其它 omp 字段（cost/thinking/compat/…）
 * 按原样保留；删除的供应商/模型随整份列表一起消失。
 * shortcut: js-yaml 往返会丢注释，保存前留一份 models.yml.bak。
 */
export function saveOmpModels(providers: OmpProviderRow[]): OmpModelsSnapshot {
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

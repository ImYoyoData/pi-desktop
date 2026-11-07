/**
 * OMP 的模型配置（~/.omp/agent/models.yml）在桌面端的编辑模型。
 *
 * YAML 里 provider / model 的字段远比这里多；界面只编辑下列字段，其余字段
 * 由主进程原样保留，避免保存一次就抹掉用户手写的 cost / thinking / compat。
 */

import type { ModelsAvailableEntry } from "./models-settings";

/** 设置页可编辑的模型行。 */
export type OmpModelRow = {
	id: string;
	name: string;
	api: string;
	contextWindow: number | null;
	maxTokens: number | null;
	reasoning: boolean;
	/** 是否接受图片输入（写回 input 的 image 项）。 */
	vision: boolean;
};

/** 设置页可编辑的供应商行。 */
export type OmpProviderRow = {
	id: string;
	api: string;
	baseUrl: string;
	apiKey: string;
	models: OmpModelRow[];
};

export type OmpModelsSnapshot = {
	providers: OmpProviderRow[];
};

export const OMP_MODEL_APIS = [
	"openai-completions",
	"openai-responses",
	"anthropic-messages",
	"google-generative-ai",
] as const;

export function newOmpProvider(partial?: Partial<OmpProviderRow>): OmpProviderRow {
	return {
		id: "",
		api: "openai-completions",
		baseUrl: "",
		apiKey: "",
		models: [],
		...partial,
	};
}

export function newOmpModel(partial?: Partial<OmpModelRow>): OmpModelRow {
	return {
		id: "",
		name: "",
		api: "",
		contextWindow: null,
		maxTokens: null,
		reasoning: false,
		vision: false,
		...partial,
	};
}

/**
 * omp 运行时真正可用的模型（来自 worker 的 modelRegistry.getAvailableModels）。
 *
 * 设置页编辑的是 models.yml 的静态行；此处是加载配置、合并内置目录并按凭据
 * 过滤后的结果 —— 也就是 `set_model` 能成功找到的那些 provider/id。composer 的
 * 模型菜单必须用它，否则拿 pi 的模型去 omp worker 里查会报 Model not found。
 *
 * 字段与 pi 侧的 `ModelsAvailableEntry` 一致，菜单构建可直接共用。
 */
export type OmpAvailableModel = ModelsAvailableEntry;

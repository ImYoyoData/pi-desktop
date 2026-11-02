/**
 * OMP 的模型配置（~/.omp/agent/models.yml）在桌面端的编辑模型。
 *
 * YAML 里 provider / model 的字段远比这里多；界面只编辑下列字段，其余字段
 * 由主进程原样保留，避免保存一次就抹掉用户手写的 cost / thinking / compat。
 */

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
	filePath: string;
	exists: boolean;
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

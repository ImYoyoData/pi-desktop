/** 智能体设置页的定制项数据模型（渲染端与主进程共用）。 */

export type CustomizationScope = "user" | "project" | "builtin" | "extension";

export type CustomizationItem = {
	/** 稳定 id（文件路径或来源标识） */
	id: string;
	name: string;
	description: string;
	filePath?: string;
	scope: CustomizationScope;
	/** 扩展/包来源名 */
	source?: string;
	/** 附加信息：工具清单、参数提示、启动命令等 */
	detail?: string;
	/** 技能/插件的启用状态（false 表示已禁用） */
	enabled?: boolean;
};

/** 已被扩展订阅的 pi 生命周期事件。 */
export type CustomizationHook = {
	event: string;
	subscribers: string[];
};

/** 可新建的定制项类型。 */
export type CustomizationCreateKind = "agents" | "skills" | "instructions" | "prompts";

export type CustomizationsSnapshot = {
	root: string | null;
	agents: CustomizationItem[];
	skills: CustomizationItem[];
	instructions: CustomizationItem[];
	prompts: CustomizationItem[];
	hooks: CustomizationHook[];
	mcp: CustomizationItem[];
	plugins: CustomizationItem[];
	tools: CustomizationItem[];
	diagnostics: string[];
};

export function emptyCustomizations(root: string | null): CustomizationsSnapshot {
	return {
		root,
		agents: [],
		skills: [],
		instructions: [],
		prompts: [],
		hooks: [],
		mcp: [],
		plugins: [],
		tools: [],
		diagnostics: [],
	};
}

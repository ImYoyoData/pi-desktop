/** 工具所属命名空间（MCP 服务器等）。 */
export type WorkerToolNamespace = {
	name: string;
	aliases: string[];
};

export type WorkerActiveTool = {
	name: string;
	brief: string;
	/** 没有命名空间的工具不带该字段。 */
	namespace?: WorkerToolNamespace;
	/** 该工具调用时可能触达其它工具（pi 的 reachesTools）。 */
	reaches?: boolean;
};

/** Snapshot of skills / extensions / tools loaded into an agent worker session. */
export type WorkerResourceSummary = {
	extensionCount: number;
	skillCount: number;
	agentsFileCount: number;
	extensionPaths: string[];
	/** Skill name + brief description (for card display). */
	skillNames: { name: string; brief: string }[];
	agentsFilePaths: string[];
	/** Active tool name + brief description (for card display). */
	activeTools: WorkerActiveTool[];
	diagnostics: string[];
};

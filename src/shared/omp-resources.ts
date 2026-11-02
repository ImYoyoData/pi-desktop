/**
 * OMP 的资源条目模型（技能 / 指令 / MCP / 扩展）。
 *
 * OMP 的资源都来自它自己的配置目录（~/.omp/agent）与项目目录（.omp），
 * 与 pi 的 ~/.pi/agent 完全分开。
 */

export type OmpResourceKind = "skills" | "instructions" | "mcp" | "extensions";

export type OmpResourceScope = "user" | "project";

export type OmpResourceItem = {
	/** 稳定 id：`<kind>:<name>`。 */
	id: string;
	name: string;
	description: string;
	/** 文件路径；MCP 条目指向其配置文件。 */
	filePath: string;
	scope: OmpResourceScope;
	kind: OmpResourceKind;
	/** 是否被禁用。 */
	enabled: boolean;
	/**
	 * OMP 的扩展 id（写 disabledExtensions 用）。
	 *
	 * 没有它的条目（如 gemini 清单式扩展）没有 omp 侧的启停开关。
	 */
	extensionId?: string;
	/** 补充信息：MCP 的命令或地址、扩展的清单路径等。 */
	detail?: string;
};

export type OmpResourcesSnapshot = {
	skills: OmpResourceItem[];
	instructions: OmpResourceItem[];
	mcp: OmpResourceItem[];
	extensions: OmpResourceItem[];
};

/** 被测的 MCP 服务器。 */
export type OmpMcpTestTarget = {
	name: string;
	scope: OmpResourceScope;
	/** 项目级服务器所在的工作区路径。 */
	workspace?: string;
};

export type OmpMcpTestResult = OmpMcpTestTarget & {
	ok: boolean;
	/** 服务器返回的工具数量（未获取到时为 undefined）。 */
	toolCount?: number;
	error?: string;
	durationMs: number;
};

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
	activeTools: { name: string; brief: string }[];
	diagnostics: string[];
};

import path from "node:path";
import { workspacePathsEqual } from "../shared/workspace-path";

const KNOWN_WORKSPACE_TTL_MS = 30_000;
const CASE_INSENSITIVE =
	process.platform === "win32" || process.platform === "darwin";

export type WorkspaceTargetDeps = {
	current: () => string | null;
	recent: () => Promise<string[]>;
};

/** 渲染端可指定别的已知工作区目录查看其仓库，未知路径回落到当前工作区。 */
export function createWorkspaceTarget({ current, recent }: WorkspaceTargetDeps) {
	let known: { paths: string[]; at: number } | null = null;

	async function knownPaths(): Promise<string[]> {
		const now = Date.now();
		if (known && now - known.at < KNOWN_WORKSPACE_TTL_MS) return known.paths;
		const paths = await recent();
		known = { paths, at: now };
		return paths;
	}

	return async function resolve(requested: unknown): Promise<string | null> {
		const root = current();
		if (typeof requested !== "string" || !requested.trim()) return root;
		const target = path.resolve(requested.trim().replace(/\\/g, "/"));
		if (root && workspacePathsEqual(root, target, CASE_INSENSITIVE)) {
			return target;
		}
		const paths = await knownPaths();
		return paths.some((entry) => workspacePathsEqual(entry, target, CASE_INSENSITIVE))
			? target
			: root;
	};
}

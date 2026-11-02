import fs from "node:fs";
import path from "node:path";
import type {
	OmpMcpTestResult,
	OmpMcpTestTarget,
} from "../shared/omp-resources";
import { ompAgentDir } from "./omp-dir";
import { testMcpServer } from "./mcp-test";

export type { OmpMcpTestResult, OmpMcpTestTarget };

/** 项目级 mcp.json 的路径。 */
function projectMcpPath(workspace: string): string {
	return path.join(path.resolve(workspace), ".omp", "mcp.json");
}

function readMcpEntry(target: OmpMcpTestTarget): Record<string, unknown> | null {
	const file =
		target.scope === "project"
			? target.workspace
				? projectMcpPath(target.workspace)
				: null
			: path.join(ompAgentDir(), "mcp.json");
	if (!file || !fs.existsSync(file)) return null;
	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return null;
	}
	const servers = (raw as { mcpServers?: Record<string, unknown> })?.mcpServers;
	const entry = servers?.[target.name];
	return entry && typeof entry === "object" && !Array.isArray(entry)
		? (entry as Record<string, unknown>)
		: null;
}

/** 测试一个 OMP MCP 服务器：initialize 握手 + tools/list。 */
export async function testOmpMcpServer(
	target: OmpMcpTestTarget,
): Promise<OmpMcpTestResult> {
	const entry = readMcpEntry(target);
	if (!entry) {
		return { ...target, ok: false, error: "server not found", durationMs: 0 };
	}
	if (entry.enabled === false) {
		return { ...target, ok: false, error: "disabled", durationMs: 0 };
	}
	const outcome = await testMcpServer(entry);
	return { ...target, ...outcome };
}

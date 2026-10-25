/** 工作区级缓存：最近一次 worker ready 上报的工具命名空间与可触达标记。 */

import path from "node:path";
import type { CustomizationRuntimeTools } from "../shared/customizations";
import type { WorkerResourceSummary } from "../shared/worker-resources";

const byRoot = new Map<string, CustomizationRuntimeTools>();

export function recordWorkerToolRuntime(
	root: string,
	sessionId: string,
	resources: WorkerResourceSummary,
): void {
	byRoot.set(path.resolve(root), {
		sessionId,
		updatedAt: Date.now(),
		tools: resources.activeTools.map((tool) => ({
			name: tool.name,
			namespace: tool.namespace?.name ?? "",
			aliases: tool.namespace?.aliases ?? [],
			reaches: tool.reaches === true,
		})),
	});
}

export function readWorkerToolRuntime(root: string): CustomizationRuntimeTools | null {
	return byRoot.get(path.resolve(root)) ?? null;
}

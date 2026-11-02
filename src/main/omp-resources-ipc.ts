import { ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import type { OmpResourceItem } from "../shared/omp-resources";
import {
	listOmpResources,
	setOmpResourceEnabled,
} from "./omp-resources-host";
import { testOmpMcpServer } from "./omp-mcp-test";
import { getWorkspace } from "./workspace-ipc";
import type { SessionBroker } from "./session-broker";
import { createWorkerRestartScheduler } from "./worker-restart-scheduler";

/** 同时测试的服务器个数：串行太慢，全量并发会瞬间拉起过多子进程。 */
const MCP_TEST_CONCURRENCY = 4;

export function registerOmpResourcesIpc(broker: SessionBroker): void {
	// OMP 的 disabledExtensions / mcp.json 变更要 worker 重读；连点开关合并成一次。
	const restartWorkers = createWorkerRestartScheduler(() =>
		broker.restartWorkersForBackend("omp"),
	);

	ipcMain.handle(IpcChannels.ompResources.list, (_event, root?: string) =>
		listOmpResources(root ?? getWorkspace() ?? undefined),
	);

	ipcMain.handle(
		IpcChannels.ompResources.setEnabled,
		(_event, item: OmpResourceItem, enabled: boolean) => {
			setOmpResourceEnabled(item, enabled);
			restartWorkers();
		},
	);

	ipcMain.handle(
		IpcChannels.ompResources.testMcp,
		(_event, targets) =>
			mapWithConcurrency(
				Array.isArray(targets) ? targets : [],
				MCP_TEST_CONCURRENCY,
				testOmpMcpServer,
			),
	);
}

/** 并发跑测试，结果保持输入顺序。 */
async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	run: (item: T) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let cursor = 0;
	async function worker(): Promise<void> {
		const index = cursor;
		cursor += 1;
		if (index >= items.length) return;
		results[index] = await run(items[index]);
		await worker();
	}
	const workers: Promise<void>[] = [];
	for (let i = 0; i < Math.min(limit, items.length); i += 1) {
		workers.push(worker());
	}
	await Promise.all(workers);
	return results;
}

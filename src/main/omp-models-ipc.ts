import { ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import type { OmpAvailableModel, OmpProviderRow } from "../shared/omp-models";
import {
	DEFAULT_CONTEXT_WINDOW,
	resolveContextWindow,
	resolveMaxTokens,
} from "../shared/model-metadata";
import { readOmpModels, saveOmpModels } from "./omp-models-config";
import type { SessionBroker } from "./session-broker";
import { broadcastStateChange } from "./ui-sync";

export function registerOmpModelsIpc(broker: SessionBroker): void {
	ipcMain.handle(IpcChannels.ompModels.get, () => readOmpModels());

	/**
	 * composer 的模型菜单要的是「omp 运行时认得哪些 provider/id」。
	 *
	 * 只有 worker 里的 modelRegistry 才知道这件事（它合并了内置目录、models.yml
	 * 与凭据过滤），所以这里问一个存活 worker。没有存活 worker 时退回 models.yml
	 * 的静态行：菜单至少能列出用户自己配的供应商，不至于空白；真正 `set_model`
	 * 时 worker 启动后会按同一份 models.yml 建表，id 对得上。
	 */
	ipcMain.handle(
		IpcChannels.ompModels.list,
		async (): Promise<OmpAvailableModel[]> => {
			const live = await broker.listBackendModels("omp");
			if (live) return live as OmpAvailableModel[];
			return staticOmpModels();
		},
	);

	ipcMain.handle(
		IpcChannels.ompModels.save,
		(_event, providers: OmpProviderRow[]) => {
			const snapshot = saveOmpModels(Array.isArray(providers) ? providers : []);
			// 存活的 omp worker 立刻按新 models.yml 重建模型表。
			void broker.notifyWorkersReloadModels("omp");
			// 输入框的模型菜单要重新拉一次，否则刚配的供应商要等到下次切会话才出现。
			broadcastStateChange({ scope: "models" });
			return snapshot;
		},
	);
}

/** 没有存活 worker 时的降级：直接用 models.yml 里声明的供应商与模型行。 */
export function staticOmpModels(): OmpAvailableModel[] {
	const rows: OmpAvailableModel[] = [];
	for (const provider of readOmpModels().providers) {
		for (const model of provider.models) {
			rows.push({
				provider: provider.id,
				id: model.id,
				name: model.name || model.id,
				api: model.api || provider.api,
				contextWindow:
					resolveContextWindow(model.contextWindow, model.id) ??
					DEFAULT_CONTEXT_WINDOW,
				maxTokens: resolveMaxTokens(model.maxTokens),
				input: model.vision ? ["text", "image"] : ["text"],
				reasoning: model.reasoning,
				// 静态行拿不到模型真正的档位表，按推理与否给默认集合，
				// 真正下发后会由 worker 的 set_thinking_level 结果纠正。
				thinkingLevels: model.reasoning
					? ["off", "minimal", "low", "medium", "high"]
					: ["off"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			});
		}
	}
	return rows.sort((a, b) => {
		const byProvider = a.provider.localeCompare(b.provider);
		if (byProvider !== 0) return byProvider;
		return (a.name || a.id).localeCompare(b.name || b.id, undefined, { numeric: true });
	});
}

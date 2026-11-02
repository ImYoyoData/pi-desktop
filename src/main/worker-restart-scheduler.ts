/**
 * 合并短时间内的多次配置变更，只做一次 worker 重建。
 *
 * 自动保存会成串写盘，逐次重建 worker 既慢又容易打断正在跑的回合。
 */
export function createWorkerRestartScheduler(
	restart: () => void | Promise<void>,
	delayMs = 1500,
): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return () => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			void restart();
		}, delayMs);
	};
}

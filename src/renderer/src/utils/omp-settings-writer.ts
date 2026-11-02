/**
 * omp 设置页的自动保存队列。
 *
 * 界面改动是连续的（滑动、连续敲键盘），直接每次写盘会让主进程反复重建
 * worker，所以这里做两件事：短时间内的改动合并成一次写入；写入期间到的
 * 改动排到下一轮，保证同一时刻只有一次写盘。
 */
export type OmpSettingsWriter = {
	/** 记下一处改动，稍后合并写入。 */
	queue: (patch: Record<string, unknown>) => void;
	/** 立即把攒下的改动写掉（切页或卸载时调用）。 */
	flush: () => void;
};

export function createOmpSettingsWriter(
	save: (patch: Record<string, unknown>) => Promise<unknown>,
	onError: (err: unknown) => void,
	delayMs = 400,
): OmpSettingsWriter {
	let pending: Record<string, unknown> = {};
	let timer: ReturnType<typeof setTimeout> | null = null;
	let writing = false;

	function clearTimer(): void {
		if (!timer) return;
		clearTimeout(timer);
		timer = null;
	}

	function flush(): void {
		clearTimer();
		if (writing) return;
		if (Object.keys(pending).length === 0) return;
		const patch = pending;
		pending = {};
		writing = true;
		void save(patch)
			.catch((err: unknown) => {
				// 写失败时丢掉这批改动：调用方重读配置，界面不会停在磁盘上没有的状态。
				pending = {};
				onError(err);
			})
			.finally(() => {
				writing = false;
				if (Object.keys(pending).length > 0) flush();
			});
	}

	return {
		queue: (patch) => {
			pending = { ...pending, ...patch };
			clearTimer();
			timer = setTimeout(flush, delayMs);
		},
		flush,
	};
}

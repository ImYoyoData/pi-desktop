export type HiddenEventSink<T> = {
	push: (event: T) => void;
	flushNow: () => void;
	/**
	 * 停止缓冲并丢弃已排队事件。
	 *
	 * 刻意不做成"此后 push 全部丢弃"：任何误调用（组件卸载、重复 stop）都会让
	 * 会话事件永久静默，界面永远停在「等待模型响应」且没有任何报错。stop 之后
	 * 退化为无缓冲直通，故障模式从"永久失效"降级为"少了层节流"。
	 */
	stop: () => void;
	readonly pending: number;
};

export function createHiddenEventSink<T>(opts: {
	apply: (event: T) => void;
	isHidden: () => boolean;
	hiddenFlushMs?: number;
	flushBatch?: number;
	onError?: (err: unknown, event: T) => void;
}): HiddenEventSink<T> {
	const hiddenFlushMs = opts.hiddenFlushMs ?? 1_000;
	const flushBatch = opts.flushBatch ?? 1_000;
	const queue: T[] = [];
	let timer: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;

	function applyOne(event: T): void {
		try {
			opts.apply(event);
		} catch (err) {
			opts.onError?.(err, event);
		}
	}

	function schedule(delayMs: number): void {
		if (timer != null) return;
		timer = setTimeout(flush, delayMs);
	}

	/** 已停止缓冲时立即消费；否则按可见性选择节流间隔。 */
	function flushDelay(): number {
		if (stopped) return 0;
		return opts.isHidden() ? hiddenFlushMs : 0;
	}

	function flush(): void {
		timer = null;
		const batch = queue.splice(0, flushBatch);
		for (const event of batch) applyOne(event);
		if (queue.length) schedule(0);
	}

	return {
		push(event: T): void {
			const direct = !stopped && !opts.isHidden() && queue.length === 0;
			if (direct) {
				applyOne(event);
				return;
			}
			queue.push(event);
			schedule(flushDelay());
		},
		flushNow(): void {
			if (opts.isHidden() || !queue.length) return;
			if (timer != null) {
				clearTimeout(timer);
				timer = null;
			}
			schedule(0);
		},
		stop(): void {
			stopped = true;
			if (timer != null) {
				clearTimeout(timer);
				timer = null;
			}
			queue.length = 0;
		},
		get pending(): number {
			return queue.length;
		},
	};
}
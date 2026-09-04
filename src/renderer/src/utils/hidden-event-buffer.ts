export type HiddenEventSink<T> = {
	push: (event: T) => void;
	flushNow: () => void;
	dispose: () => void;
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
	let disposed = false;

	function schedule(delayMs: number): void {
		if (disposed || timer != null) return;
		timer = setTimeout(flush, delayMs);
	}

	function flush(): void {
		timer = null;
		if (disposed) return;
		const batch = queue.splice(0, flushBatch);
		for (const event of batch) {
			try {
				opts.apply(event);
			} catch (err) {
				opts.onError?.(err, event);
			}
		}
		if (queue.length) schedule(0);
	}

	return {
		push(event: T): void {
			if (disposed) return;
			if (opts.isHidden() || queue.length > 0) {
				queue.push(event);
				schedule(opts.isHidden() ? hiddenFlushMs : 0);
				return;
			}
			opts.apply(event);
		},
		flushNow(): void {
			if (disposed || opts.isHidden() || !queue.length) return;
			if (timer != null) {
				clearTimeout(timer);
				timer = null;
			}
			schedule(0);
		},
		dispose(): void {
			disposed = true;
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOmpSettingsWriter } from "../../src/renderer/src/utils/omp-settings-writer";

describe("omp 设置自动保存队列", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("短时间内的连续改动合并成一次写入", async () => {
		const save = vi.fn(async () => undefined);
		const writer = createOmpSettingsWriter(save, vi.fn(), 400);

		writer.queue({ "todo.enabled": true });
		writer.queue({ "grep.enabled": false });
		writer.queue({ "todo.enabled": false });

		expect(save).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(400);
		expect(save).toHaveBeenCalledTimes(1);
		expect(save).toHaveBeenCalledWith({
			"todo.enabled": false,
			"grep.enabled": false,
		});
	});

	it("写入期间的改动排到下一轮，不并发写盘", async () => {
		const gate = { release: (): void => {} };
		const save = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					gate.release = resolve;
				}),
		);
		const writer = createOmpSettingsWriter(save, vi.fn(), 400);

		writer.queue({ a: 1 });
		await vi.advanceTimersByTimeAsync(400);
		expect(save).toHaveBeenCalledTimes(1);

		writer.queue({ b: 2 });
		await vi.advanceTimersByTimeAsync(400);
		expect(save).toHaveBeenCalledTimes(1);

		gate.release();
		await vi.advanceTimersByTimeAsync(0);
		expect(save).toHaveBeenCalledTimes(2);
		expect(save).toHaveBeenLastCalledWith({ b: 2 });
	});

	it("写失败时报错并丢掉这批改动", async () => {
		const save = vi.fn(async () => {
			throw new Error("disk full");
		});
		const onError = vi.fn();
		const writer = createOmpSettingsWriter(save, onError, 400);

		writer.queue({ a: 1 });
		await vi.advanceTimersByTimeAsync(400);

		expect(onError).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1000);
		expect(save).toHaveBeenCalledTimes(1);
	});

	it("flush 立即写入，不等防抖窗口", async () => {
		const save = vi.fn(async () => undefined);
		const writer = createOmpSettingsWriter(save, vi.fn(), 400);

		writer.queue({ a: 1 });
		writer.flush();
		expect(save).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1000);
		expect(save).toHaveBeenCalledTimes(1);
	});
});

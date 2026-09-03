import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHiddenEventSink } from "../../src/renderer/src/utils/hidden-event-buffer";

type Sink = ReturnType<typeof createHiddenEventSink<number>>;

describe("hidden-event-buffer", () => {
	let hidden = false;
	let applied: number[] = [];
	let sink: Sink;

	beforeEach(() => {
		vi.useFakeTimers();
		hidden = false;
		applied = [];
		sink = createHiddenEventSink<number>({
			apply: (n) => applied.push(n),
			isHidden: () => hidden,
			hiddenFlushMs: 1_000,
			flushBatch: 3,
		});
	});

	afterEach(() => {
		sink.dispose();
		vi.useRealTimers();
	});

	it("applies immediately while visible", () => {
		sink.push(1);
		sink.push(2);
		expect(applied).toEqual([1, 2]);
		expect(sink.pending).toBe(0);
	});

	it("buffers while hidden and bulk-flushes on the hidden cadence", () => {
		hidden = true;
		sink.push(1);
		sink.push(2);
		expect(applied).toEqual([]);
		expect(sink.pending).toBe(2);

		vi.advanceTimersByTime(1_000);
		expect(applied).toEqual([1, 2]);
		expect(sink.pending).toBe(0);
	});

	it("drains large hidden backlogs in batches across macrotasks", () => {
		hidden = true;
		for (let i = 1; i <= 8; i++) sink.push(i);

		vi.advanceTimersByTime(1_000);
		expect(applied).toEqual([1, 2, 3]);
		vi.advanceTimersByTime(1);
		expect(applied).toEqual([1, 2, 3, 4, 5, 6]);
		vi.advanceTimersByTime(1);
		expect(applied).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
		expect(sink.pending).toBe(0);
	});

	it("flushNow on visibility restore drains the backlog immediately", () => {
		hidden = true;
		sink.push(1);
		sink.push(2);
		hidden = false;
		sink.flushNow();
		vi.advanceTimersByTime(0);
		expect(applied).toEqual([1, 2]);
		expect(sink.pending).toBe(0);
	});

	it("flushNow is a no-op while still hidden", () => {
		hidden = true;
		sink.push(1);
		sink.flushNow();
		vi.advanceTimersByTime(0);
		expect(applied).toEqual([]);
	});

	it("routes new events through a draining backlog to preserve order", () => {
		hidden = true;
		for (let i = 1; i <= 5; i++) sink.push(i);
		hidden = false;
		sink.flushNow();
		sink.push(6);
		expect(applied).toEqual([]);
		vi.advanceTimersByTime(10);
		expect(applied).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it("keeps applying later events when one apply throws", () => {
		sink.dispose();
		sink = createHiddenEventSink<number>({
			apply: (n) => {
				if (n === 2) throw new Error("boom");
				applied.push(n);
			},
			isHidden: () => hidden,
			hiddenFlushMs: 1_000,
			flushBatch: 3,
			onError: vi.fn(),
		});
		hidden = true;
		sink.push(1);
		sink.push(2);
		sink.push(3);
		vi.advanceTimersByTime(1_000);
		expect(applied).toEqual([1, 3]);
	});

	it("dispose drops the backlog and pending timer", () => {
		hidden = true;
		sink.push(1);
		sink.dispose();
		vi.advanceTimersByTime(5_000);
		expect(applied).toEqual([]);
		expect(sink.pending).toBe(0);
	});
});

import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	net: { fetch: () => Promise.reject(new Error("no network in tests")) },
	app: { getPath: () => "" },
}));

import { createTtlCache } from "../../src/main/github-list";

describe("createTtlCache.run", () => {
	it("shares one in-flight load per key", async () => {
		const cache = createTtlCache<number>();
		const load = vi.fn(async () => 7);

		const [left, right] = await Promise.all([cache.run("a", load), cache.run("a", load)]);

		expect([left, right]).toEqual([7, 7]);
		expect(load).toHaveBeenCalledTimes(1);
		expect(await cache.run("a", load)).toBe(7);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("does not remember failures", async () => {
		const cache = createTtlCache<number>();
		const load = vi.fn(async () => {
			throw new Error("boom");
		});

		await expect(cache.run("a", load)).rejects.toThrow("boom");
		await expect(cache.run("a", load)).rejects.toThrow("boom");
		expect(load).toHaveBeenCalledTimes(2);
	});

	it("clear drops remembered values", async () => {
		const cache = createTtlCache<number>();
		const load = vi.fn(async () => 1);

		await cache.run("a", load);
		cache.clear();

		expect(cache.get("a")).toBeUndefined();
	});
});

describe("createTtlCache freshness windows", () => {
	it("keeps stale entries readable after the fresh window", () => {
		vi.useFakeTimers();
		try {
			const cache = createTtlCache<number>(1000, { staleMs: 60_000 });
			cache.remember("a", 1);
			vi.advanceTimersByTime(2000);
			expect(cache.get("a")).toBeUndefined();
			expect(cache.entry("a")?.value).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("drops entries past the stale window", () => {
		vi.useFakeTimers();
		try {
			const cache = createTtlCache<number>(1000, { staleMs: 5000 });
			cache.remember("a", 1);
			vi.advanceTimersByTime(6000);
			expect(cache.entry("a")).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	it("evicts the oldest entry over the limit", () => {
		const cache = createTtlCache<number>(60_000, { limit: 2 });
		cache.remember("a", 1);
		cache.remember("b", 2);
		cache.remember("c", 3);
		expect(cache.get("a")).toBeUndefined();
		expect(cache.get("c")).toBe(3);
	});

	it("forgets only the matching prefix", () => {
		const cache = createTtlCache<number>(60_000);
		cache.remember("host/repo#1", 1);
		cache.remember("host/repo#2", 2);
		cache.remember("host/other#1", 3);
		cache.forgetPrefix("host/repo#");
		expect(cache.get("host/repo#1")).toBeUndefined();
		expect(cache.get("host/repo#2")).toBeUndefined();
		expect(cache.get("host/other#1")).toBe(3);
	});
});

describe("createTtlCache persistence hooks", () => {
	it("rehydrates from load and reports changes through save", () => {
		const saved: Record<string, { value: number; at: number }>[] = [];
		const cache = createTtlCache<number>(60_000, {
			load: () => ({ a: { value: 1, at: Date.now() } }),
			save: (entries) => saved.push(entries),
		});

		expect(cache.get("a")).toBe(1);

		cache.remember("b", 2);
		expect(saved).toHaveLength(1);
		expect(Object.keys(saved[0]).sort()).toEqual(["a", "b"]);

		cache.forget("a");
		expect(Object.keys(saved[1])).toEqual(["b"]);
	});
});

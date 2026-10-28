import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	net: { fetch: () => Promise.reject(new Error("no network in tests")) },
	app: { getPath: () => "" },
}));

const PAGE_FILE = "desktop-github-pages.json";
const DETAIL_FILE = "desktop-github-details.json";

let dir = "";

function readEntries(fileName: string): Record<string, unknown> {
	const parsed = JSON.parse(fs.readFileSync(path.join(dir, fileName), "utf8")) as {
		entries?: Record<string, unknown>;
	};
	return parsed.entries ?? {};
}

async function loadCacheModule() {
	vi.resetModules();
	return import("../../src/main/github-cache");
}

const page = { pullRequests: [], nextCursor: null, totalCount: 0, repository: "o/r" };
const detail = { body: "hello" } as never;

describe("github-cache", () => {
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-gh-cache-"));
		vi.stubEnv("PI_CODING_AGENT_DIR", dir);
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("keeps pages and details in separate files", async () => {
		const cache = await loadCacheModule();

		cache.pageCacheOptions().save?.({ "o/r#open": { value: page, at: Date.now() } });
		cache.detailCacheOptions().save?.({ "https://github.com/o/r/pull/1": { value: detail, at: Date.now() } });
		vi.advanceTimersByTime(1000);

		expect(Object.keys(readEntries(PAGE_FILE))).toEqual(["o/r#open"]);
		expect(Object.keys(readEntries(DETAIL_FILE))).toEqual(["https://github.com/o/r/pull/1"]);
	});

	it("rehydrates saved entries on the next start", async () => {
		const first = await loadCacheModule();
		first.pageCacheOptions().save?.({ "o/r#open": { value: page, at: Date.now() } });
		vi.advanceTimersByTime(1000);

		const second = await loadCacheModule();
		expect(Object.keys(second.pageCacheOptions().load?.() ?? {})).toEqual(["o/r#open"]);
	});

	it("ignores a corrupt cache file", async () => {
		fs.writeFileSync(path.join(dir, PAGE_FILE), "{not json", "utf8");
		const cache = await loadCacheModule();
		expect(cache.pageCacheOptions().load?.()).toEqual({});
	});
});

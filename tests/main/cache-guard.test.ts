import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const userDataMock = vi.fn<(dir: string) => string>();

vi.mock("electron", () => ({
	app: {
		getPath: (name: string) => {
			if (name === "userData") return userDataMock(name);
			return "";
		},
	},
}));

import { guardChromiumCacheDirs } from "../../src/main/cache-guard";

describe("cache-guard", () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-cache-"));
		userDataMock.mockReturnValue(dir);
	});

	it("leaves a writable cache dir alone", () => {
		const cacheDir = path.join(dir, "Cache");
		fs.mkdirSync(cacheDir, { recursive: true });
		fs.writeFileSync(path.join(cacheDir, "index"), "data");

		guardChromiumCacheDirs();

		expect(fs.existsSync(cacheDir)).toBe(true);
		expect(fs.existsSync(path.join(cacheDir, "index"))).toBe(true);
	});

	it("deletes a cache dir that is not writable", () => {
		const cacheDir = path.join(dir, "Cache");
		fs.mkdirSync(cacheDir, { recursive: true });
		fs.writeFileSync(path.join(cacheDir, "index"), "data");

		// Make the probe write fail (dir turned into a file).
		fs.rmSync(cacheDir, { recursive: true, force: true });
		fs.writeFileSync(cacheDir, "not a dir");

		guardChromiumCacheDirs();

		expect(fs.existsSync(cacheDir)).toBe(false);
	});

	it("handles a missing cache dir gracefully", () => {
		expect(() => guardChromiumCacheDirs()).not.toThrow();
	});

	it("resets each of the known Chromium cache dirs", () => {
		for (const name of [
			"Cache",
			"GPUCache",
			"Code Cache",
			"DawnGraphiteCache",
			"DawnWebGPUCache",
		]) {
			const p = path.join(dir, name);
			fs.writeFileSync(p, "corrupt");
		}

		guardChromiumCacheDirs();

		for (const name of [
			"Cache",
			"GPUCache",
			"Code Cache",
			"DawnGraphiteCache",
			"DawnWebGPUCache",
		]) {
			expect(fs.existsSync(path.join(dir, name))).toBe(false);
		}
	});
});

import { describe, expect, it } from "vitest";
import {
	bundledNpmCliPath,
	bundledNpmAvailable,
	resolveNpmRunner,
} from "../../src/main/bundled-npm";

describe("bundled-npm", () => {
	it("locates the bundled npm cli", () => {
		const cli = bundledNpmCliPath();
		expect(cli).toMatch(/npm[\\/]bin[\\/]npm-cli\.js$/);
		expect(bundledNpmAvailable()).toBe(true);
	});

	it("prefers a user-configured npmCommand", () => {
		const runner = resolveNpmRunner(["my-npm", "--flag"]);
		expect(runner.source).toBe("configured");
		expect(runner.command).toBe("my-npm");
		expect(runner.args).toEqual(["--flag"]);
	});

	it("falls back to bundled npm when nothing is configured", () => {
		// On this machine either a system npm exists (source "system") or the
		// bundled npm is used (source "bundled"). Both must produce a usable
		// command vector.
		const runner = resolveNpmRunner();
		expect(["system", "bundled"]).toContain(runner.source);
		expect(runner.command.length).toBeGreaterThan(0);
	});
});

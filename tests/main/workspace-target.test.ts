import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceTarget } from "../../src/main/workspace-target";

const root = path.resolve("/work/alpha");
const other = path.resolve("/work/beta");
const unknown = path.resolve("/work/gamma");

function target(options: { recent?: () => Promise<string[]> } = {}) {
	return createWorkspaceTarget({
		current: () => root,
		recent: options.recent ?? (async () => [root, other]),
	});
}

describe("createWorkspaceTarget", () => {
	it("falls back to the current workspace for unknown paths", async () => {
		await expect(target()(unknown)).resolves.toBe(root);
	});

	it("accepts a known workspace path", async () => {
		await expect(target()(other)).resolves.toBe(other);
	});

	it("accepts the current workspace itself", async () => {
		await expect(target()(root)).resolves.toBe(root);
	});

	it("keeps the current workspace when nothing is requested", async () => {
		const resolve = target();
		await expect(resolve(undefined)).resolves.toBe(root);
		await expect(resolve("   ")).resolves.toBe(root);
	});

	it("treats other separators as the same directory", async () => {
		await expect(target()(other.replace(/\//g, "\\"))).resolves.toBe(other);
	});

	it("caches the recent workspace list", async () => {
		const recent = vi.fn(async () => [other]);
		const resolve = target({ recent });
		await resolve(unknown);
		await resolve(unknown);
		expect(recent).toHaveBeenCalledTimes(1);
	});

	it("has no fallback when no workspace is open", async () => {
		const resolve = createWorkspaceTarget({
			current: () => null,
			recent: async () => [],
		});
		await expect(resolve(other)).resolves.toBeNull();
	});
});

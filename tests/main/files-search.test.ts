import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { searchWorkspaceFiles } from "../../src/main/files-host";

const temps: string[] = [];

afterEach(() => {
	for (const dir of temps.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

function makeTree(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-at-search-"));
	temps.push(root);
	fs.mkdirSync(path.join(root, "src", "components"), { recursive: true });
	fs.writeFileSync(path.join(root, "README.md"), "# hi");
	fs.writeFileSync(
		path.join(root, "src", "components", "Composer.vue"),
		"<template />",
	);
	fs.writeFileSync(path.join(root, "src", "main.ts"), "export {}");
	fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
	fs.writeFileSync(path.join(root, "node_modules", "pkg", "index.js"), "");
	return root;
}

describe("searchWorkspaceFiles", () => {
	it("lists root when query empty", () => {
		const root = makeTree();
		const entries = searchWorkspaceFiles(root, "");
		expect(entries.map((e) => e.name).sort()).toEqual(["README.md", "src"]);
	});

	it("matches nested files and skips node_modules", () => {
		const root = makeTree();
		const entries = searchWorkspaceFiles(root, "composer");
		expect(entries.map((e) => e.path)).toEqual(["src/components/Composer.vue"]);
		expect(
			searchWorkspaceFiles(root, "index").every(
				(e) => !e.path.includes("node_modules"),
			),
		).toBe(true);
	});

	it("searches absolute / pasted paths outside the workspace walk", () => {
		const root = makeTree();
		const absQuery = path.join(root, "src", "components", "comp");
		const entries = searchWorkspaceFiles(root, absQuery);
		const expected = path
			.join(root, "src", "components", "Composer.vue")
			.replace(/\\/g, "/");
		expect(entries.map((e) => e.path)).toContain(expected);
		expect(
			entries[0]!.path.startsWith("/") || /^[a-zA-Z]:\//.test(entries[0]!.path),
		).toBe(true);
	});

	it("supports fuzzy camelCase and multi-token queries", () => {
		const root = makeTree();
		fs.writeFileSync(
			path.join(root, "src", "components", "ComposerAtFileMenu.vue"),
			"<template />",
		);
		expect(searchWorkspaceFiles(root, "cafm").map((e) => e.name)).toContain(
			"ComposerAtFileMenu.vue",
		);
		expect(
			searchWorkspaceFiles(root, "comp vue").some(
				(e) => e.name === "Composer.vue",
			),
		).toBe(true);
	});
});

it("searches dotfiles and dot-directories (not just node_modules filtering)", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-at-dot-"));
	fs.mkdirSync(path.join(root, ".config"), { recursive: true });
	fs.writeFileSync(path.join(root, ".env.local"), "x", "utf8");
	fs.writeFileSync(path.join(root, ".config", "settings.json"), "{}", "utf8");
	fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
	fs.writeFileSync(path.join(root, "node_modules", "skipme.js"), "x", "utf8");
	fs.writeFileSync(path.join(root, ".gitignore"), "node_modules", "utf8");

	// Dotfiles and dot-dirs are searchable now.
	const env = searchWorkspaceFiles(root, "env");
	expect(env.some((e) => e.path === ".env.local")).toBe(true);
	const cfg = searchWorkspaceFiles(root, "settings");
	expect(cfg.some((e) => e.path === ".config/settings.json")).toBe(true);
	const gi = searchWorkspaceFiles(root, "gitignore");
	expect(gi.some((e) => e.path === ".gitignore")).toBe(true);
	// node_modules stays excluded.
	const nm = searchWorkspaceFiles(root, "skipme");
	expect(nm.some((e) => e.path.includes("node_modules"))).toBe(false);

	fs.rmSync(root, { recursive: true, force: true });
});

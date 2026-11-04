import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	readOmpSetting,
	writeOmpSetting,
} from "../../src/shared/omp-settings";
import { saveOmpSettings } from "../../src/main/omp-settings-host";
import { saveOmpModels } from "../../src/main/omp-models-config";

describe("omp settings 路径读写", () => {
	let doc: Record<string, unknown>;

	beforeEach(() => {
		doc = { theme: { light: "light" }, topLevel: 1 };
	});

	it("按点分路径读到嵌套值", () => {
		expect(readOmpSetting(doc, "theme.light")).toBe("light");
		expect(readOmpSetting(doc, "theme.dark")).toBeUndefined();
		expect(readOmpSetting(doc, "missing.deep.key")).toBeUndefined();
	});

	it("写入嵌套值并保留兄弟字段", () => {
		writeOmpSetting(doc, "theme.dark", "dark");
		expect(doc).toEqual({
			theme: { light: "light", dark: "dark" },
			topLevel: 1,
		});
	});

	it("删除值时清掉变空的父节点", () => {
		writeOmpSetting(doc, "theme.light", null);
		expect(doc).toEqual({ topLevel: 1 });
	});

	it("删除不存在的键不改动文档", () => {
		writeOmpSetting(doc, "absent.key", null);
		expect(doc).toEqual({ theme: { light: "light" }, topLevel: 1 });
	});
});

describe("omp models.yml 合并", () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-omp-models-"));
		process.env.OMP_AGENT_DIR = dir;
	});

	afterEach(() => {
		delete process.env.OMP_AGENT_DIR;
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("保存时保留 models.yml 里未知的字段", async () => {
		const { saveOmpModels, readOmpModels } = await import(
			"../../src/main/omp-models-config"
		);
		fs.writeFileSync(
			path.join(dir, "models.yml"),
			[
				"providers:",
				"  magpie:",
				"    api: openai-completions",
				"    compat:",
				"      promptCacheSessionHeader: x-session-affinity",
				"    models:",
				"      - id: model-a",
				"        cost:",
				"          input: 0.15",
				"",
			].join("\n"),
			"utf8",
		);

		const snapshot = saveOmpModels([
			{
				id: "magpie",
				api: "openai-completions",
				baseUrl: "",
				apiKey: "",
				models: [
					{
						id: "model-a",
						name: "Model A",
						api: "",
						contextWindow: null,
						maxTokens: null,
						reasoning: false,
						vision: false,
					},
				],
			},
		]);

		expect(snapshot.providers[0]?.models[0]?.id).toBe("model-a");
		const raw = fs.readFileSync(path.join(dir, "models.yml"), "utf8");
		expect(raw).toContain("promptCacheSessionHeader");
		expect(raw).toContain("input: 0.15");
		expect(readOmpModels().providers).toHaveLength(1);
	});

	it("拒绝空 id 与重复 id 且不改动文件", () => {
		const file = path.join(dir, "models.yml");
		const original = "providers: {}\n";
		fs.writeFileSync(file, original, "utf8");
		const model = {
			id: "model-a",
			name: "",
			api: "",
			contextWindow: null,
			maxTokens: null,
			reasoning: false,
			vision: false,
		};
		const provider = (id: string, models = [model]) => ({
			id,
			api: "",
			baseUrl: "",
			apiKey: "",
			models,
		});

		expect(() => saveOmpModels([provider("")])).toThrow(/不能为空/);
		expect(() => saveOmpModels([provider("magpie"), provider("magpie", [])])).toThrow(
			/重复/,
		);
		expect(() =>
			saveOmpModels([
				provider("magpie", [model, { ...model }]),
			]),
		).toThrow(/模型 id 重复/);
		expect(fs.readFileSync(file, "utf8")).toBe(original);
	});
});

describe("omp config.yml 保存", () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-omp-config-"));
		process.env.OMP_AGENT_DIR = dir;
	});

	afterEach(() => {
		delete process.env.OMP_AGENT_DIR;
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("配置解析失败时拒绝保存并保留原文", () => {
		const file = path.join(dir, "config.yml");
		fs.writeFileSync(file, "a: [1,\n", "utf8");
		expect(() => saveOmpSettings({})).toThrow("invalid YAML");
		expect(fs.readFileSync(file, "utf8")).toBe("a: [1,\n");
	});
});

describe("omp 设置 schema 的桌面端过滤", () => {
	const schema = require("../../src/shared/omp-settings-schema.json") as {
		tabs: { id: string; groups: string[] }[];
		settings: { id: string; tab: string; group: string | null }[];
	};

	it("不含只影响 TUI 渲染的设置", () => {
		const prefixes = ["tui.", "terminal.", "display.", "statusLine.", "composer.", "theme."];
		const leaked = schema.settings
			.map((entry) => entry.id)
			.filter((id) => prefixes.some((prefix) => id.startsWith(prefix)));
		expect(leaked).toEqual([]);
	});

	it("外观页整体不导出", () => {
		expect(schema.tabs.map((tab) => tab.id)).not.toContain("appearance");
		expect(schema.settings.some((entry) => entry.tab === "appearance")).toBe(false);
	});

	it("每个 tab 与 group 都至少有一个设置项", () => {
		for (const tab of schema.tabs) {
			expect(schema.settings.some((entry) => entry.tab === tab.id)).toBe(true);
			for (const group of tab.groups) {
				const hit = schema.settings.some(
					(entry) => entry.tab === tab.id && entry.group === group,
				);
				expect(hit, `${tab.id}/${group}`).toBe(true);
			}
		}
	});

	it("每项设置的 tab 都在导出的 tab 列表里", () => {
		const tabIds = new Set(schema.tabs.map((tab) => tab.id));
		for (const entry of schema.settings) {
			expect(tabIds.has(entry.tab), entry.id).toBe(true);
		}
	});
});

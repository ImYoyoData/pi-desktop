import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { staticOmpModels } from "../../src/main/omp-models-ipc";

/**
 * `ompModels:list` 在没有存活 worker 时退回 models.yml 的静态行。
 * 这条降级路很关键：切到 omp 后如果菜单空白，用户连自己配的模型都选不到。
 */
describe("staticOmpModels", () => {
	let agentDir: string;

	beforeEach(() => {
		agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-omp-static-"));
		process.env.OMP_AGENT_DIR = agentDir;
	});

	afterEach(() => {
		delete process.env.OMP_AGENT_DIR;
		fs.rmSync(agentDir, { recursive: true, force: true });
	});

	it("没有 models.yml 时返回空数组", () => {
		expect(staticOmpModels()).toEqual([]);
	});

	it("把每个供应商的每个模型展开成一行", () => {
		fs.writeFileSync(
			path.join(agentDir, "models.yml"),
			[
				"providers:",
				"  local:",
				"    api: openai-completions",
				"    baseUrl: http://127.0.0.1:1234/v1",
				"    models:",
				"      - id: m1",
				"        name: Model One",
				"        contextWindow: 32000",
				"        maxTokens: 4000",
				"      - id: m2",
				"        reasoning: true",
				"        input: [text, image]",
				"",
			].join("\n"),
			"utf8",
		);

		const rows = staticOmpModels();
		// 按显示名排序：m2 没有 name，回退用 id “m2”，排在 “Model One” 之前。
		expect(rows.map((r) => r.id)).toEqual(["m2", "m1"]);
		const m1 = rows.find((r) => r.id === "m1");
		const m2 = rows.find((r) => r.id === "m2");
		expect(m1).toMatchObject({
			provider: "local",
			name: "Model One",
			api: "openai-completions",
			contextWindow: 32000,
			maxTokens: 4000,
			reasoning: false,
			input: ["text"],
			thinkingLevels: ["off"],
		});
		// 缺省字段用公共默认，而不是 0 / null：菜单与上下文估算都依赖它们。
		expect(m1?.contextWindow).toBe(32000);
		expect(m1?.maxTokens).toBe(4000);
		expect(m2).toMatchObject({
			reasoning: true,
			input: ["text", "image"],
		});
		expect(m2?.thinkingLevels).toEqual(["off", "minimal", "low", "medium", "high"]);
		expect(m2?.contextWindow).toBeGreaterThan(0);
		expect(m2?.maxTokens).toBeGreaterThan(0);
	});

	it("按供应商与显示名排序，与运行时路径一致", () => {
		fs.writeFileSync(
			path.join(agentDir, "models.yml"),
			[
				"providers:",
				"  zeta:",
				"    api: openai-completions",
				"    models:",
				"      - id: b",
				"        name: Beta",
				"      - id: a",
				"        name: Alpha",
				"  alpha:",
				"    api: openai-completions",
				"    models:",
				"      - id: c",
				"",
			].join("\n"),
			"utf8",
		);

		expect(staticOmpModels().map((r) => `${r.provider}/${r.name}`)).toEqual([
			"alpha/c",
			"zeta/Alpha",
			"zeta/Beta",
		]);
	});

	it("供应商未写 api 时退回该供应商的 api", () => {
		fs.writeFileSync(
			path.join(agentDir, "models.yml"),
			[
				"providers:",
				"  p:",
				"    api: anthropic-messages",
				"    models:",
				"      - id: m",
				"",
			].join("\n"),
			"utf8",
		);
		expect(staticOmpModels()[0]?.api).toBe("anthropic-messages");
	});
});

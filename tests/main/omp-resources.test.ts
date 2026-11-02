import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	listOmpResources,
	setOmpResourceEnabled,
} from "../../src/main/omp-resources-host";

describe("omp 资源扫描与启停", () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-omp-res-"));
		process.env.OMP_AGENT_DIR = dir;
	});

	afterEach(() => {
		delete process.env.OMP_AGENT_DIR;
		fs.rmSync(dir, { recursive: true, force: true });
	});

	function writeSkill(name: string, description: string): void {
		const skillDir = path.join(dir, "skills", name);
		fs.mkdirSync(skillDir, { recursive: true });
		fs.writeFileSync(
			path.join(skillDir, "SKILL.md"),
			`---\nname: ${name}\ndescription: ${description}\n---\n\n正文\n`,
			"utf8",
		);
	}

	it("列出技能与扩展，并标记缺少 description 的技能", () => {
		writeSkill("alpha", "第一个技能");
		const skillDir = path.join(dir, "skills", "beta");
		fs.mkdirSync(skillDir, { recursive: true });
		fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# beta\n", "utf8");
		fs.mkdirSync(path.join(dir, "extensions"), { recursive: true });
		fs.writeFileSync(path.join(dir, "extensions", "tool.ts"), "export {};\n", "utf8");

		const snapshot = listOmpResources();
		expect(snapshot.skills.map((item) => item.name).sort()).toEqual([
			"alpha",
			"beta",
		]);
		expect(snapshot.skills.find((item) => item.name === "alpha")?.enabled).toBe(
			true,
		);
		expect(snapshot.skills.find((item) => item.name === "beta")?.detail).toContain(
			"description",
		);
		expect(snapshot.extensions.map((item) => item.name)).toEqual(["tool"]);
	});

	it("禁用技能写入 disabledExtensions，重新启用后移除", () => {
		writeSkill("alpha", "第一个技能");
		const snapshot = listOmpResources();
		const skill = snapshot.skills[0]!;

		setOmpResourceEnabled(skill, false);
		expect(listOmpResources().skills[0]?.enabled).toBe(false);

		setOmpResourceEnabled(skill, true);
		expect(listOmpResources().skills[0]?.enabled).toBe(true);
	});

	it("禁用 MCP 写入 mcp.json 的 enabled 字段", () => {
		fs.writeFileSync(
			path.join(dir, "mcp.json"),
			JSON.stringify({ mcpServers: { demo: { command: "echo" } } }, null, 2),
			"utf8",
		);
		const snapshot = listOmpResources();
		const server = snapshot.mcp[0]!;
		expect(server.enabled).toBe(true);

		setOmpResourceEnabled(server, false);
		const raw = JSON.parse(
			fs.readFileSync(path.join(dir, "mcp.json"), "utf8"),
		) as { mcpServers: Record<string, { enabled?: boolean }> };
		expect(raw.mcpServers.demo?.enabled).toBe(false);
		expect(listOmpResources().mcp[0]?.enabled).toBe(false);
	});
});

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

	it("用户级 denylist 里的服务器，点启用后真的恢复", () => {
		fs.writeFileSync(
			path.join(dir, "mcp.json"),
			JSON.stringify(
				{ mcpServers: { demo: { command: "echo" } }, disabledServers: ["demo"] },
				null,
				2,
			),
			"utf8",
		);
		const server = listOmpResources().mcp[0]!;
		expect(server.enabled).toBe(false);

		setOmpResourceEnabled(server, true);
		expect(listOmpResources().mcp[0]?.enabled).toBe(true);
		const raw = JSON.parse(fs.readFileSync(path.join(dir, "mcp.json"), "utf8")) as {
			disabledServers?: string[];
		};
		expect(raw.disabledServers).toBeUndefined();
	});

	it("frontmatter 的块标量描述被正确读成文本", () => {
		const skillDir = path.join(dir, "skills", "blockscalar");
		fs.mkdirSync(skillDir, { recursive: true });
		fs.writeFileSync(
			path.join(skillDir, "SKILL.md"),
			[
				"---",
				"name: blockscalar",
				"description: >",
				"  第一行描述",
				"  第二行描述",
				"---",
				"",
				"正文",
			].join(String.fromCharCode(10)),
			"utf8",
		);
		const skill = listOmpResources().skills.find((item) => item.name === "blockscalar");
		expect(skill?.description).toBe("第一行描述 第二行描述");
		expect(skill?.detail).toBeUndefined();
	});

	it("项目级与用户级同名资源只列一条，项目级优先", () => {
		const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-omp-proj-"));
		const projectSkills = path.join(projectRoot, ".omp", "skills", "alpha");
		fs.mkdirSync(projectSkills, { recursive: true });
		fs.writeFileSync(
			path.join(projectSkills, "SKILL.md"),
			["---", "name: alpha", "description: 项目级", "---", ""].join(
				String.fromCharCode(10),
			),
			"utf8",
		);
		writeSkill("alpha", "用户级");

		const skills = listOmpResources(projectRoot).skills;
		expect(skills).toHaveLength(1);
		expect(skills[0]?.scope).toBe("project");
		fs.rmSync(projectRoot, { recursive: true, force: true });
	});

	it("项目级 MCP 开关按 scope 与工作区写文件，忽略渲染层路径", () => {
		const projectRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-desk-omp-mcp-proj-"),
		);
		try {
			const projectMcp = path.join(projectRoot, ".omp", "mcp.json");
			fs.mkdirSync(path.dirname(projectMcp), { recursive: true });
			fs.writeFileSync(
				projectMcp,
				JSON.stringify({ mcpServers: { demo: { command: "echo" } } }),
				"utf8",
			);
			const victim = path.join(dir, "victim.json");
			fs.writeFileSync(victim, JSON.stringify({ untouched: true }), "utf8");

			const server = listOmpResources(projectRoot).mcp[0]!;
			setOmpResourceEnabled({ ...server, filePath: victim }, false, projectRoot);

			const written = JSON.parse(fs.readFileSync(projectMcp, "utf8")) as {
				mcpServers: Record<string, { enabled?: boolean }>;
			};
			expect(written.mcpServers.demo?.enabled).toBe(false);
			expect(JSON.parse(fs.readFileSync(victim, "utf8"))).toEqual({
				untouched: true,
			});
		} finally {
			fs.rmSync(projectRoot, { recursive: true, force: true });
		}
	});

	it("项目级 MCP 开关缺少工作区时拒绝写入", () => {
		const projectRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-desk-omp-mcp-proj-"),
		);
		try {
			const projectMcp = path.join(projectRoot, ".omp", "mcp.json");
			fs.mkdirSync(path.dirname(projectMcp), { recursive: true });
			fs.writeFileSync(
				projectMcp,
				JSON.stringify({ mcpServers: { demo: { command: "echo" } } }),
				"utf8",
			);
			const server = listOmpResources(projectRoot).mcp[0]!;
			expect(() => setOmpResourceEnabled(server, false)).toThrow(
				"workspace required",
			);
		} finally {
			fs.rmSync(projectRoot, { recursive: true, force: true });
		}
	});
});

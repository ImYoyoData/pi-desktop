import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { testOmpMcpServer } from "../../src/main/omp-mcp-test";

describe("omp MCP 连接测试", () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-omp-mcp-"));
		process.env.OMP_AGENT_DIR = dir;
	});

	afterEach(() => {
		delete process.env.OMP_AGENT_DIR;
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("对不存在的服务器返回失败", async () => {
		const result = await testOmpMcpServer({ name: "nope", scope: "user" });
		expect(result.ok).toBe(false);
		expect(result.error).toBe("server not found");
	});

	it("已禁用的服务器不测试", async () => {
		fs.writeFileSync(
			path.join(dir, "mcp.json"),
			JSON.stringify({
				mcpServers: { demo: { command: "node", enabled: false } },
			}),
			"utf8",
		);
		const result = await testOmpMcpServer({ name: "demo", scope: "user" });
		expect(result.ok).toBe(false);
		expect(result.error).toBe("disabled");
	});

	it("stdio 服务器握手成功并拿到工具数量", async () => {
		const serverPath = path.join(dir, "server.js");
		fs.writeFileSync(
			serverPath,
			[
				'let buf = "";',
				'process.stdin.setEncoding("utf8");',
				'process.stdin.on("data", (chunk) => {',
				'  buf += chunk;',
				'  let nl;',
				'  while ((nl = buf.indexOf("\\n")) >= 0) {',
				'    const line = buf.slice(0, nl).trim();',
				'    buf = buf.slice(nl + 1);',
				'    if (!line) continue;',
				'    const msg = JSON.parse(line);',
				'    if (msg.id === 1) {',
				'      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "fake", version: "1" } } }) + "\\n");',
				'    } else if (msg.id === 2) {',
				'      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "a" }, { name: "b" }] } }) + "\\n");',
				'    }',
				'  }',
				'});',
			].join("\n"),
			"utf8",
		);
		fs.writeFileSync(
			path.join(dir, "mcp.json"),
			JSON.stringify({
				mcpServers: { demo: { command: process.execPath, args: [serverPath] } },
			}),
			"utf8",
		);

		const result = await testOmpMcpServer({ name: "demo", scope: "user" });
		expect(result.ok).toBe(true);
		expect(result.toolCount).toBe(2);
	});
});

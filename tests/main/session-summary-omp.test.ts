import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { summarizeSessionFile } from "../../src/main/session-history-worker";

const L = String.fromCharCode(10);

describe("会话摘要：omp 的标题槽", () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-summary-"));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	function write(lines: unknown[]): string {
		const file = path.join(dir, "s.jsonl");
		fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join(L) + L, "utf8");
		return file;
	}

	it("首行是 title 槽时仍能读出会话，标题取槽里的名字", () => {
		const now = new Date().toISOString();
		const file = write([
			{ type: "title", v: 1, title: "代码审查", source: "user", updatedAt: now, pad: "" },
			{ type: "session", version: 3, id: "s1", timestamp: now, cwd: "/tmp/x" },
			{ type: "message", id: "u1", timestamp: now, message: { role: "user", content: [{ type: "text", text: "你好" }] } },
		]);
		const row = summarizeSessionFile(file);
		expect(row?.id).toBe("s1");
		expect(row?.name).toBe("代码审查");
		expect(row?.cwd).toBe("/tmp/x");
		expect(row?.firstMessage).toBe("你好");
	});

	it("没有 title 槽时照旧从 header 读", () => {
		const now = new Date().toISOString();
		const file = write([
			{ type: "session", version: 3, id: "s2", timestamp: now, cwd: "/tmp/y" },
			{ type: "message", id: "u1", timestamp: now, message: { role: "user", content: [{ type: "text", text: "hi" }] } },
		]);
		expect(summarizeSessionFile(file)?.id).toBe("s2");
	});

	it("文件名不是会话时返回 null", () => {
		const file = path.join(dir, "junk.jsonl");
		fs.writeFileSync(file, "not json" + L, "utf8");
		expect(summarizeSessionFile(file)).toBeNull();
	});
});

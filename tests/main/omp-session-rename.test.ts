import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	renameOmpSessionFile,
	serializeOmpTitleSlot,
} from "../../src/main/omp-session-rename";

function titleOf(raw: Buffer): string {
	const newline = raw.subarray(0, 256).indexOf(0x0a);
	const parsed = JSON.parse(raw.toString("utf8", 0, newline)) as {
		title?: string;
	};
	return parsed.title ?? "";
}

describe("omp 会话改名", () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-omp-rename-"));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("没有 title slot 时补一行且保留正文", async () => {
		const file = path.join(dir, "session.jsonl");
		const header = `${JSON.stringify({ type: "session", version: 3, id: "s1" })}\n`;
		fs.writeFileSync(file, header, "utf8");

		await renameOmpSessionFile(file, "新标题");

		const raw = fs.readFileSync(file);
		expect(titleOf(raw)).toBe("新标题");
		expect(raw.toString("utf8").endsWith(header)).toBe(true);
	});

	it("已有 title slot 时原地覆盖，正文长度不变", async () => {
		const file = path.join(dir, "session.jsonl");
		const body = `${JSON.stringify({ type: "message", role: "user" })}\n`;
		fs.writeFileSync(file, serializeOmpTitleSlot("旧标题", "user") + body, "utf8");
		const before = fs.statSync(file).size;

		await renameOmpSessionFile(file, "新标题");

		const raw = fs.readFileSync(file);
		expect(titleOf(raw)).toBe("新标题");
		expect(fs.statSync(file).size).toBe(before);
		expect(raw.toString("utf8").endsWith(body)).toBe(true);
	});
});

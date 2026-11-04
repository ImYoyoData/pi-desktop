import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendChatMeta, readChatMeta } from "../../src/main/session-chat-meta";

let dir = "";
let file = "";

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-meta-"));
	file = path.join(dir, "session.jsonl");
});

afterEach(() => {
	fs.rmSync(dir, { recursive: true, force: true });
});

describe("appendChatMeta", () => {
	it("keeps the display text of an expanded command without tags", () => {
		appendChatMeta(file, "Review src carefully.", [], "/review src");

		expect(readChatMeta(file)).toEqual([
			{
				text: "Review src carefully.",
				tags: [],
				displayText: "/review src",
			},
		]);
	});

	it("merges tags and display text for the same agent text", () => {
		appendChatMeta(file, "shared text", [
			{ url: "C:/a.ts", host: "", label: "a.ts" },
		]);
		appendChatMeta(file, "shared text", [], "original");

		const [entry] = readChatMeta(file);
		expect(entry?.tags).toHaveLength(1);
		expect(entry?.displayText).toBe("original");
	});

	it("ignores entries without tags or display text", () => {
		appendChatMeta(file, "plain", []);

		expect(readChatMeta(file)).toEqual([]);
	});
});

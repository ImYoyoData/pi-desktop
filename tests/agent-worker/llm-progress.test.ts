import { beforeAll, describe, expect, it } from "vitest";
import {
	configureLlmProgress,
	installLlmProgressProbe,
} from "../../src/agent-worker/llm-progress";

type Event = Record<string, unknown>;

const events: Event[] = [];
let baseUrl = "https://api.example.com/v1";

beforeAll(() => {
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : String(input);
		if (url.includes("boom")) throw new Error("network down");
		return new Response("{}", { status: 200 });
	}) as typeof globalThis.fetch;
	installLlmProgressProbe();
	configureLlmProgress({
		sink: (event) => events.push(event),
		baseUrl: () => baseUrl,
	});
});

describe("llm progress probe", () => {
	it("reports sent then response for a model request", async () => {
		events.length = 0;
		await fetch("https://api.example.com/v1/chat/completions", { method: "POST" });
		expect(events.map((e) => e.stage)).toEqual(["sent", "response"]);
		expect(events[0]?.host).toBe("api.example.com");
		expect(events[1]?.status).toBe(200);
	});

	it("reports failed when the request throws", async () => {
		events.length = 0;
		await expect(
			fetch("https://api.example.com/v1/boom", { method: "POST" }),
		).rejects.toThrow("network down");
		expect(events.map((e) => e.stage)).toEqual(["sent", "failed"]);
		expect(events[1]?.host).toBe("api.example.com");
		expect(events[1]?.error).toBe("network down");
	});

	it("ignores requests to other hosts", async () => {
		events.length = 0;
		await fetch("https://mcp.example.org/rpc", { method: "POST" });
		expect(events).toHaveLength(0);
	});

	it("follows baseUrl changes without reinstalling", async () => {
		baseUrl = "https://other.test/v1";
		events.length = 0;
		await fetch("https://other.test/v1/messages", { method: "POST" });
		expect(events).toHaveLength(2);
		baseUrl = "https://api.example.com/v1";
	});

	it("accepts a bare-domain baseUrl", async () => {
		baseUrl = "api.example.com/v1";
		events.length = 0;
		await fetch("https://api.example.com/v1/chat/completions", { method: "POST" });
		expect(events).toHaveLength(2);
		baseUrl = "https://api.example.com/v1";
	});
});

import { describe, expect, it, vi } from "vitest";

const created: { leafId?: string; name?: string } = {};

vi.mock("@oh-my-pi/pi-coding-agent", () => {
	const branch = [
		{ type: "model_change", id: "m1" },
		{
			type: "message",
			id: "u1",
			message: { role: "user", content: [{ type: "text", text: "hello" }] },
		},
		{
			type: "message",
			id: "a1",
			message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
		},
		{
			type: "message",
			id: "u2",
			message: { role: "user", content: [{ type: "text", text: "second" }] },
		},
		{
			type: "message",
			id: "a2",
			message: { role: "assistant", content: [{ type: "text", text: "bye" }] },
		},
	];
	return {
		SessionManager: {
			open: async () => ({
				getBranch: () => branch,
				getSessionName: () => "源会话",
				createBranchedSession: (leafId: string) => {
					created.leafId = leafId;
					return "/tmp/forked.jsonl";
				},
				setSessionName: async (name: string) => {
					created.name = name;
				},
				getSessionId: () => "fork-id",
				getCwd: () => "/tmp",
			}),
		},
	};
});

const { forkOmpUserTurn } = await import("../../src/omp-worker/fork");

describe("omp 分叉", () => {
	it("以该轮最后一条消息为叶子，丢掉后面的轮次", async () => {
		created.leafId = undefined;
		created.name = undefined;
		const result = await forkOmpUserTurn("/tmp/src.jsonl", 0, "hello");
		expect(created.leafId).toBe("a1");
		expect(result).toEqual({
			id: "fork-id",
			filePath: "/tmp/forked.jsonl",
			cwd: "/tmp",
		});
	});

	it("用该轮提问作为新会话标题", async () => {
		created.name = undefined;
		await forkOmpUserTurn("/tmp/src.jsonl", 0, "hello");
		expect(created.name).toBe("hello");
	});

	it("下标越界时报错，不复用别的轮次", async () => {
		created.leafId = undefined;
		await expect(forkOmpUserTurn("/tmp/src.jsonl", 9)).rejects.toThrow(/not found/);
		expect(created.leafId).toBeUndefined();
	});

	it("界面文案对不上时不分叉", async () => {
		created.leafId = undefined;
		await expect(forkOmpUserTurn("/tmp/src.jsonl", 0, "完全不同的内容")).rejects.toThrow(
			/no longer matches/,
		);
		expect(created.leafId).toBeUndefined();
	});

	it("没有会话文件时不动作", async () => {
		await expect(forkOmpUserTurn("   ", 0)).rejects.toThrow(/session file not found/);
	});
});

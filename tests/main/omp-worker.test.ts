import { describe, expect, it, vi } from "vitest";
import { createOmpAskUserTool } from "../../src/omp-worker/ask-user-tool";
import { rollbackOmpUserTurn, rollbackOmpTurnEnd } from "../../src/omp-worker/rollback";
import { readOmpContextUsage } from "../../src/omp-worker/context-usage";

/** 最小可用的 ask_user 参数。 */
function askParams() {
	return {
		questions: [
			{
				id: "mode",
				header: "模式",
				prompt: "选一个模式？",
				type: "single",
				options: [
					{ id: "a", label: "A" },
					{ id: "b", label: "B" },
				],
			},
		],
	};
}

describe("omp ask_user 工具", () => {
	it("把用户回答作为工具结果返回", async () => {
		const waitForAnswers = vi.fn(async () => "A");
		const tool = createOmpAskUserTool({ waitForAnswers });

		const result = await tool.execute("call-1", askParams(), undefined, undefined, undefined);

		expect(waitForAnswers).toHaveBeenCalledOnce();
		expect(result.content).toEqual([{ type: "text", text: "A" }]);
	});

	it("回答带图片时一并返回", async () => {
		const tool = createOmpAskUserTool({
			waitForAnswers: async () => ({
				text: "看图",
				images: [{ data: "AAA", mimeType: "image/png" }],
			}),
		});

		const result = await tool.execute("call-2", askParams(), undefined, undefined, undefined);

		expect(result.content).toEqual([
			{ type: "text", text: "看图" },
			{ type: "image", data: "AAA", mimeType: "image/png" },
		]);
	});

	it("参数不合法时报错", async () => {
		const tool = createOmpAskUserTool({ waitForAnswers: async () => "A" });
		await expect(
			tool.execute("call-3", { questions: [] }, undefined, undefined, undefined),
		).rejects.toThrow(/ask_user/);
	});

	it("回答为空时报错", async () => {
		const tool = createOmpAskUserTool({ waitForAnswers: async () => "  " });
		await expect(
			tool.execute("call-4", askParams(), undefined, undefined, undefined),
		).rejects.toThrow(/no answers/);
	});
});

/** 构造一个最小的会话桩：分支里两轮 user 对话。 */
function sessionStub(userTexts: string[]) {
	const entries = userTexts.map((text, index) => ({
		id: `u${index}`,
		type: "message" as const,
		message: { role: "user" as const, content: [{ type: "text" as const, text }] },
	}));
	const navigated: string[] = [];
	return {
		navigated,
		sessionManager: {
			getBranch: () => entries,
			getEntry: (id: string) => entries.find((entry) => entry.id === id),
			getLeafId: () => entries.at(-1)?.id ?? null,
			appendCustomEntry: () => "mark",
		},
		navigateTree: async (id: string) => {
			navigated.push(id);
			return { cancelled: false };
		},
	};
}

describe("omp 回退", () => {
	it("放弃指定轮次时导航到该 user 消息", async () => {
		const session = sessionStub(["第一轮", "第二轮"]);
		const ok = await rollbackOmpUserTurn(session as never, 0, "第一轮");
		expect(ok).toBe(true);
		expect(session.navigated).toEqual(["u0"]);
	});

	it("界面文案与分支不一致时不回退", async () => {
		const session = sessionStub(["第一轮"]);
		const ok = await rollbackOmpUserTurn(session as never, 0, "完全不同的内容");
		expect(ok).toBe(false);
		expect(session.navigated).toEqual([]);
	});

	it("下标越界时不顺延到更早的轮次", async () => {
		const session = sessionStub(["第一轮"]);
		const ok = await rollbackOmpUserTurn(session as never, 5, undefined);
		expect(ok).toBe(false);
		expect(session.navigated).toEqual([]);
	});

	it("回退到某轮结束：末轮已在那里就不动", async () => {
		const session = sessionStub(["第一轮"]);
		const ok = await rollbackOmpTurnEnd(session as never, 0, undefined);
		expect(ok).toBe(true);
		expect(session.navigated).toEqual([]);
	});
});

describe("omp 上下文用量映射", () => {
	it("把 omp 的分段字段归并到桌面端分段", () => {
		const usage = readOmpContextUsage({
			getContextUsage: () => ({ tokens: 1200, contextWindow: 10000, percent: 12 }),
			getSessionStats: () => ({
				toolCalls: 3,
				totalMessages: 8,
				tokens: { input: 100, output: 50, cacheRead: 7, cacheWrite: 2 },
				cost: 0.25,
			}),
			getContextBreakdown: () => ({
				systemPromptTokens: 100,
				systemToolsTokens: 200,
				systemContextTokens: 10,
				skillsTokens: 10,
				messagesTokens: 800,
			}),
			model: { provider: "magpie", id: "model-a" },
			thinkingLevel: "high",
		} as never);

		expect(usage).not.toBeNull();
		expect(usage?.tokens).toBe(1200);
		expect(usage?.percent).toBe(12);
		expect(usage?.model).toEqual({ provider: "magpie", id: "model-a" });
		expect(usage?.toolCalls).toBe(3);
		expect(usage?.costUsd).toBe(0.25);
		expect(usage?.segments).toEqual([
			{ id: "system", tokens: 120 },
			{ id: "tools", tokens: 200 },
			{ id: "conversation", tokens: 800 },
		]);
	});

	it("没有用量时返回 null", () => {
		expect(
			readOmpContextUsage({ getContextUsage: () => undefined } as never),
		).toBeNull();
	});
});

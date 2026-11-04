import { describe, expect, it, vi } from "vitest";
import { createOmpAskUserTool } from "../../src/omp-worker/ask-user-tool";

const OPTIONS = [
	{ id: "y", label: "Yes" },
	{ id: "n", label: "No" },
];

const QUESTIONS = [
	{
		id: "q1",
		header: "确认",
		prompt: "OK?",
		type: "buttons" as const,
		options: OPTIONS,
	},
];

describe("createOmpAskUserTool", () => {
	it("takes the abort signal from the custom-tool execute position", async () => {
		const waitForAnswers = vi.fn(async () => "done");
		const tool = createOmpAskUserTool({ waitForAnswers });
		const controller = new AbortController();

		const result = await tool.execute(
			"tc-1",
			{ questions: QUESTIONS },
			undefined,
			{},
			controller.signal,
		);

		expect(waitForAnswers).toHaveBeenCalledOnce();
		const [questionsArg, signalArg, callId] = waitForAnswers.mock.calls[0]!;
		expect(signalArg).toBe(controller.signal);
		expect(callId).toBe("tc-1");
		expect(questionsArg[0]?.id).toBe("q1");
		expect(result.content).toEqual([{ type: "text", text: "done" }]);
	});
});

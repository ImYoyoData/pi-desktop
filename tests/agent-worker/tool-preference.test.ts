import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createToolPreferenceExtension } from "../../src/agent-worker/tool-preference";

type SystemPromptOptions = {
	selectedTools: string[];
	hiddenTools: string[];
	promptGuidelines: string[];
};

const ALL_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

function mount() {
	const handlers = new Map<string, (event: never) => unknown>();
	const pi = {
		on: (event: string, handler: (event: never) => unknown) => {
			handlers.set(event, handler);
			return () => {};
		},
	} as unknown as ExtensionAPI;
	createToolPreferenceExtension()(pi);
	const emit = (event: string, payload: unknown): unknown =>
		handlers.get(event)?.(payload as never);
	return { emit, has: (event: string) => handlers.has(event) };
}

function promptOptions(selectedTools: string[], hiddenTools: string[] = []): SystemPromptOptions {
	return { selectedTools, hiddenTools, promptGuidelines: [] };
}

function rulesFor(selectedTools: string[], hiddenTools: string[] = []): string {
	const { emit } = mount();
	const options = promptOptions(selectedTools, hiddenTools);
	emit("before_agent_start", { systemPromptOptions: options });
	return options.promptGuidelines.join("\n");
}

describe("tool-preference extension", () => {
	it("registers both handlers", () => {
		const { has } = mount();
		expect(has("before_agent_start")).toBe(true);
		expect(has("tool_result")).toBe(true);
	});

	it("points content search at grep and maps shell flags to its parameters", () => {
		const rules = rulesFor(ALL_TOOLS);
		expect(rules).toContain("Search file contents with `grep`");
		expect(rules).toContain("`context` covers -A/-B");
		expect(rules).toContain("`limit` covers `| head`");
		expect(rules).toContain("`glob` covers --include");
		expect(rules).toContain("Reserve bash for builds");
	});

	it("tells the model that an explicit path does not reach ignored directories", () => {
		const rules = rulesFor(ALL_TOOLS);
		expect(rules).toContain("does not override the ignore rules");
		expect(rules).toContain("rg --no-ignore");
		expect(rules).not.toContain("Pass an explicit `path` to search inside node_modules");
	});

	it("falls back to shell rg when grep is not active", () => {
		const rules = rulesFor(["read", "bash", "edit", "write"]);
		expect(rules).toContain("no grep tool is active");
		expect(rules).toContain("bash handles builds");
		expect(rules).not.toContain("Search file contents with `grep`");
		expect(rules).not.toContain("Reserve bash");
	});

	it("treats hidden tools as inactive", () => {
		const rules = rulesFor(ALL_TOOLS, ["grep"]);
		expect(rules).toContain("no grep tool is active");
	});

	it("names the shell that is actually active", () => {
		const rules = rulesFor(["read", "powershell", "edit", "write", "grep"]);
		expect(rules).toContain("Reserve powershell for builds");
		expect(rules).not.toContain("Reserve bash for builds");
	});

	it("keeps the guideline list free of duplicates", () => {
		const { emit } = mount();
		const options = promptOptions(ALL_TOOLS);
		emit("before_agent_start", { systemPromptOptions: options });
		emit("before_agent_start", { systemPromptOptions: options });
		expect(new Set(options.promptGuidelines).size).toBe(options.promptGuidelines.length);
	});

	it("annotates an empty grep result with the ignore boundary", () => {
		const { emit } = mount();
		const result = emit("tool_result", {
			toolName: "grep",
			isError: false,
			content: [{ type: "text", text: "No matches found" }],
		}) as { content: { type: string; text: string }[] };
		expect(result.content).toHaveLength(1);
		expect(result.content[0].text).toContain("No matches found");
		expect(result.content[0].text).toContain("rg --no-ignore");
	});

	it("leaves non-empty, failed, and other tool results untouched", () => {
		const { emit } = mount();
		expect(
			emit("tool_result", {
				toolName: "grep",
				isError: false,
				content: [{ type: "text", text: "a.ts:1: hit" }],
			}),
		).toBeUndefined();
		expect(
			emit("tool_result", {
				toolName: "grep",
				isError: true,
				content: [{ type: "text", text: "No matches found" }],
			}),
		).toBeUndefined();
		expect(
			emit("tool_result", {
				toolName: "find",
				isError: false,
				content: [{ type: "text", text: "No matches found" }],
			}),
		).toBeUndefined();
	});
});

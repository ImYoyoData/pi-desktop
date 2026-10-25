/**
 * 让模型优先调用 pi 内置工具（grep / find / ls / read），而不是在 bash 里跑同名命令。
 *
 * 内置工具的 promptGuidelines 默认是空的，模型没有理由放弃 shell 手感；这里在
 * before_agent_start 里给当前活跃工具补规则，由 pi 以 system prompt 增量下发，
 * 不替换整段提示，也不依赖项目里的 AGENTS.md。
 */
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

const TOOL_PREFERENCE_GUIDELINES: Record<string, readonly string[]> = {
	grep: [
		"Search file contents with this tool instead of shelling out to grep/rg/git grep: it caps matches (100 per call) and skips .gitignore'd paths. Pass an explicit `path` to search inside node_modules, dist, or out.",
		"Write alternatives as one regex, e.g. `(a|b|c)`: there is no shell `\\|`, no `| head`, and no `2>/dev/null` here.",
	],
	find: ["Locate files with this tool instead of shell find/dir."],
	ls: ["List a directory with this tool instead of shell ls."],
	read: ["Read file contents with this tool instead of shell cat/head/tail/sed/awk."],
	bash: [
		"Reserve bash for what the other tools cannot do: pipelines (sort/uniq/xargs), asymmetric context (-A2 -B6), builds, tests, git, and other CLIs. Plain content search, file reads, and directory listings belong to grep/find/ls/read.",
	],
};

export function createToolPreferenceExtension(): ExtensionFactory {
	return (pi) => {
		pi.on("before_agent_start", (event) => {
			const options = event.systemPromptOptions;
			const guidelines = { ...options.toolGuidelines };
			for (const [name, rules] of Object.entries(TOOL_PREFERENCE_GUIDELINES)) {
				guidelines[name] = [...new Set([...(guidelines[name] ?? []), ...rules])];
			}
			options.toolGuidelines = guidelines;
		});
	};
}

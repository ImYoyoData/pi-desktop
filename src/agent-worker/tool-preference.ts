/**
 * 让模型优先调用 pi 内置工具（grep / find / ls / read），而不是在 shell 里跑同名命令。
 *
 * 规则按当前声明的工具动态生成：grep 未激活时不能提 grep，激活时要讲清它和 shell 的能力边界。
 * 规则写进 promptGuidelines（不按 selectedTools 过滤），由 before_agent_start 每轮重新生成。
 * bash 的 promptSnippet 由上游写成 "Execute bash commands (ls, grep, find, etc.)"，
 * 桌面注册时换成 BASH_PROMPT_SNIPPET，避免工具清单把搜索直接派给 shell。
 */
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

export const BASH_PROMPT_SNIPPET =
	"Execute bash commands (builds, tests, git, pipelines, and other CLIs)";

const SHELL_WORKDIR_GUIDELINE =
	"Every shell call already starts in the session working directory (the <cwd> value); changing directory inside one call does not carry to the next. Do not prefix commands with `cd <project path>`, `Set-Location <project path>`, or `git -C <project path>`; use relative paths.";

const GREP_IGNORE_NOTICE =
	"grep skips .gitignore'd paths (node_modules, out, build, release) even when `path` points at them. Only those directories need `rg --no-ignore` through the shell; every normal search stays on this tool.";

function preferenceGuidelines(declared: readonly string[]): string[] {
	const has = (name: string) => declared.includes(name);
	const shell = has("bash") ? "bash" : has("powershell") ? "powershell" : undefined;
	const rules: string[] = [];
	if (shell) {
		rules.push(
			has("grep")
				? `Reserve ${shell} for builds, tests, git, post-processing pipelines (sort/uniq/xargs), and other CLIs. Searching file contents, reading files, and listing directories belong to grep / read / ls.`
				: `${shell} handles builds, tests, git, content search, post-processing pipelines (sort/uniq/xargs), and other CLIs.`,
			SHELL_WORKDIR_GUIDELINE,
		);
	}
	if (has("grep")) {
		rules.push(
			"Search file contents with `grep` instead of shelling out to grep/rg/git grep: it takes pattern, path, glob, ignoreCase, literal, context and limit. Do not pipe to head or redirect stderr — it caps matches and reports truncation itself.",
			GREP_IGNORE_NOTICE,
		);
	} else if (shell) {
		rules.push(`Search file contents with ${shell} \`rg\`; no grep tool is active.`);
	}
	if (has("find")) rules.push("Locate files with `find` (glob + path) instead of shell find/dir.");
	if (has("ls")) rules.push("List a directory with `ls` instead of shell ls.");
	if (has("read")) rules.push("Read file contents with `read` instead of shell cat/head/tail/sed/awk.");
	return rules;
}

export function createToolPreferenceExtension(): ExtensionFactory {
	return (pi) => {
		pi.on("before_agent_start", (event) => {
			const options = event.systemPromptOptions;
			const declared = options.selectedTools.filter((name) => !options.hiddenTools.includes(name));
			options.promptGuidelines = [
				...new Set([...options.promptGuidelines, ...preferenceGuidelines(declared)]),
			];
		});
		pi.on("tool_result", (event) => {
			if (event.toolName !== "grep" || event.isError) return;
			const text = event.content.map((block) => (block.type === "text" ? block.text : "")).join("");
			if (text !== "No matches found") return;
			return { content: [{ type: "text", text: `${text}\n\n${GREP_IGNORE_NOTICE}` }] };
		});
	};
}

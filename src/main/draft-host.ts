/** 草稿落地：提示模板与指令文件的创建。 */

import fs from "node:fs";
import path from "node:path";
import { agentDir } from "./agent-dir";
import type {
	InstructionsSaveResult,
	PromptIssueCode,
	PromptSaveResult,
} from "../shared/customizations";

const NAME_MAX = 100;
/** 文件名保留字符与路径分隔符（Windows 一并禁止）。 */
const NAME_INVALID = /[\\/:*?"<>|\u0000-\u001f]/;

/** 名称在文件系统层面的校验。 */
function nameIssue(name: string): PromptIssueCode | null {
	if (!name) return "name-required";
	if (name.length > NAME_MAX || name === "." || name === ".." || NAME_INVALID.test(name)) {
		return "name-invalid";
	}
	return null;
}

/** 按草稿创建指令文件：用户级 <agentDir>/AGENTS.md，工作区 <workspace>/AGENTS.md。 */
export function createInstructionsFromDraft(
	content: string,
	scope: "user" | "project",
	workspace?: string,
): InstructionsSaveResult {
	const root = scope === "project" ? workspace?.trim() : agentDir();
	if (!root) throw new Error("workspace required");
	const filePath = path.join(root, "AGENTS.md");
	if (fs.existsSync(filePath)) return { ok: false, code: "exists" };
	fs.mkdirSync(root, { recursive: true });
	fs.writeFileSync(filePath, content, "utf8");
	return { ok: true, filePath };
}

/** 按草稿创建提示模板：文件名即命令名，用户级 <agentDir>/prompts，工作区 <workspace>/.pi/prompts。 */
export function createPromptFromDraft(
	content: string,
	name: string,
	scope: "user" | "project",
	workspace?: string,
): PromptSaveResult {
	const issue = nameIssue(name);
	if (issue) return { ok: false, code: issue };
	const root =
		scope === "project"
			? workspace?.trim()
				? path.join(workspace.trim(), ".pi", "prompts")
				: null
			: path.join(agentDir(), "prompts");
	if (!root) throw new Error("workspace required");
	const filePath = path.join(root, `${name}.md`);
	if (fs.existsSync(filePath)) return { ok: false, code: "exists" };
	fs.mkdirSync(root, { recursive: true });
	fs.writeFileSync(filePath, content, "utf8");
	return { ok: true, filePath, name };
}

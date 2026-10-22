/** 草稿落地：指令文件的创建。 */

import fs from "node:fs";
import path from "node:path";
import { agentDir } from "./agent-dir";
import type { InstructionsSaveResult } from "../shared/customizations";

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

import fs from "node:fs";
import path from "node:path";
import { agentDir } from "./agent-dir";
import { withFrontmatterName } from "./frontmatter";
import { isPathInsideRoot } from "../shared/path-sandbox";
import type {
  AgentIssueCode,
  AgentSaveResult,
  InstructionsSaveResult,
} from "../shared/customizations";

const AGENT_NAME_MAX = 100;
/** 文件名保留字符与路径分隔符（Windows 一并禁止）。 */
const AGENT_NAME_INVALID = /[\\/:*?"<>|\u0000-\u001f]/;

/** 智能体名称在文件系统层面的校验（不做 pi 规范校验）。 */
function agentNameIssue(name: string): AgentIssueCode | null {
  if (!name) return "name-required";
  if (name.length > AGENT_NAME_MAX || name === "." || name === ".." || AGENT_NAME_INVALID.test(name)) {
    return "name-invalid";
  }
  return null;
}

/** 智能体目录：用户级 <agentDir>/agents，工作区 <workspace>/.pi/agents。 */
function agentDraftRoot(scope: "user" | "project", workspace?: string): string | null {
  if (scope === "project") {
    const root = workspace?.trim();
    return root ? path.join(root, ".pi", "agents") : null;
  }
  return path.join(agentDir(), "agents");
}

/** 可改动的智能体目录（不含内置与扩展）。 */
function editableAgentRoots(cwd?: string): string[] {
  const roots = [path.resolve(agentDir(), "agents")];
  const project = cwd?.trim() ? path.resolve(cwd.trim(), ".pi", "agents") : null;
  if (project) roots.push(project);
  return roots;
}

/** 按草稿创建智能体文件：名称取 frontmatter.name（由调用方解析）。 */
export function createAgentFromDraft(
  content: string,
  name: string,
  scope: "user" | "project",
  workspace?: string,
): AgentSaveResult {
  const issue = agentNameIssue(name);
  if (issue) return { ok: false, code: issue };
  const root = agentDraftRoot(scope, workspace);
  if (!root) throw new Error("workspace required");
  const filePath = path.join(root, `${name}.md`);
  if (fs.existsSync(filePath)) return { ok: false, code: "exists" };
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return { ok: true, filePath, name };
}

/** 重命名智能体文件并同步 frontmatter name。 */
function renameAgent(filePath: string, name: string, cwd?: string): AgentSaveResult {
  const issue = agentNameIssue(name);
  if (issue) return { ok: false, code: issue };
  if (!fs.existsSync(filePath)) throw new Error("Agent not found");
  const dir = path.resolve(path.dirname(filePath));
  if (!editableAgentRoots(cwd).some((base) => isPathInsideRoot(base, dir))) {
    throw new Error("Only user and workspace agents can be renamed");
  }
  const ext = path.extname(filePath) || ".md";
  const nextPath = path.join(dir, `${name}${ext}`);
  if (path.resolve(nextPath) === path.resolve(filePath)) return { ok: true, filePath, name };
  if (fs.existsSync(nextPath)) return { ok: false, code: "exists" };
  const content = fs.readFileSync(filePath, "utf8");
  fs.writeFileSync(filePath, withFrontmatterName(content, name), "utf8");
  fs.renameSync(filePath, nextPath);
  return { ok: true, filePath: nextPath, name };
}

/** 保存智能体：先写内容，名称变化时重命名文件并同步 frontmatter name。 */
export function saveAgentContent(
  filePath: string,
  content: string,
  name: string,
  renameName: string | undefined,
  cwd?: string,
): AgentSaveResult {
  const dir = path.resolve(path.dirname(filePath));
  if (!editableAgentRoots(cwd).some((base) => isPathInsideRoot(base, dir))) {
    throw new Error("Only user and workspace agents can be edited");
  }
  fs.writeFileSync(filePath, content, "utf8");
  const currentName = path.basename(filePath, path.extname(filePath));
  if (!renameName || renameName === currentName) return { ok: true, filePath, name };
  return renameAgent(filePath, renameName, cwd);
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

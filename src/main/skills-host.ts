import fs from "node:fs";
import path from "node:path";
import { agentDir, homeDir } from "./agent-dir";
import { SKILL_NAME_PATTERN } from "./skill-validate";
import { isPathInsideRoot } from "../shared/path-sandbox";
import { resolveTrustState } from "./project-trust";

export type SkillDto = {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  source: string;
  scope: string;
  disableModelInvocation: boolean;
};

export async function listSkills(cwd: string): Promise<{ skills: SkillDto[]; diagnostics: string[] }> {
  const {
    DefaultResourceLoader,
    getAgentDir,
    SettingsManager,
  } = await import("@earendil-works/pi-coding-agent");
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir, {
    projectTrusted: resolveTrustState(cwd, agentDir).projectTrusted,
  });
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
  await loader.reload();
  const { skills, diagnostics } = loader.getSkills();
  return {
    skills: skills.map((s) => ({
      name: s.name,
      description: s.description,
      filePath: s.filePath,
      baseDir: s.baseDir,
      source: s.sourceInfo?.source ?? "path",
      scope: s.sourceInfo?.scope ?? "path",
      disableModelInvocation: Boolean(s.disableModelInvocation),
    })),
    diagnostics: diagnostics.map((d) => d.message ?? String(d)),
  };
}

/** 按编辑器草稿创建技能：内容原样写入，名称与描述由 frontmatter 解析后校验。 */
export function createSkillFromDraft(
  content: string,
  name: string,
  description: string,
  scope: "user" | "project",
  cwd?: string,
): { filePath: string } {
  if (name.length > 64 || !SKILL_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid skill name: ${name}`);
  }
  if (!description) throw new Error("Skill description is required in frontmatter");
  const root = cwd?.trim() || null;
  if (scope === "project" && !root) throw new Error("workspace required");
  const skillsRoot =
    scope === "project" && root ? path.join(root, ".pi", "skills") : path.join(agentDir(), "skills");
  const filePath = path.join(skillsRoot, name, "SKILL.md");
  if (fs.existsSync(filePath)) throw new Error(`Skill already exists: ${name}`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return { filePath };
}

export async function setSkillDisabled(filePath: string, disableModelInvocation: boolean): Promise<void> {
  if (!fs.existsSync(filePath)) {
    throw new Error("skill file not found");
  }
  const content = fs.readFileSync(filePath, "utf8");
  const key = "disable-model-invocation";
  const { parseFrontmatter } = await import("@earendil-works/pi-coding-agent");
  const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
  const alreadySet = Boolean(frontmatter[key]);

  let updated = content;
  if (disableModelInvocation && !alreadySet) {
    updated = content.replace(/^---\r?\n/, `---\n${key}: true\n`);
    if (updated === content) {
      updated = `---\n${key}: true\n---\n${content}`;
    }
  } else if (!disableModelInvocation && alreadySet) {
    updated = content.replace(new RegExp(`^${key}\\s*:.*\\r?\\n`, "m"), "");
  }
  fs.writeFileSync(filePath, updated, "utf8");
}

/** 可改动的技能根：用户级（pi/agents）与当前工作区，用于改名或删除。 */
function skillActionRoots(agentSkills: string, cwd?: string): string[] {
  const roots = [agentSkills, path.resolve(homeDir(), ".agents", "skills")];
  const projectSkills = cwd?.trim() ? path.resolve(cwd.trim(), ".pi", "skills") : null;
  if (projectSkills) roots.push(projectSkills);
  return roots;
}

/** 重命名技能：目录改名并同步 frontmatter 的 name，只允许用户级与工作区级技能。 */
export function renameSkill(
  filePath: string,
  name: string,
  cwd?: string,
): { filePath: string; name: string } {
  if (name.length > 64 || !SKILL_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid skill name: ${name}`);
  }
  if (!fs.existsSync(filePath)) throw new Error("Skill not found");
  const skillDir = path.resolve(path.dirname(filePath));
  const roots = skillActionRoots(path.resolve(agentDir(), "skills"), cwd);
  if (!roots.some((base) => isPathInsideRoot(base, skillDir))) {
    throw new Error("Only user and workspace skills can be renamed");
  }
  if (roots.includes(skillDir)) {
    throw new Error("Refusing to rename the skills root directory");
  }
  const fileName = path.basename(filePath);
  const nextDir = path.join(path.dirname(skillDir), name);
  if (path.resolve(nextDir) === skillDir) return { filePath, name };
  if (fs.existsSync(nextDir)) throw new Error(`Skill already exists: ${name}`);
  const content = fs.readFileSync(filePath, "utf8");
  const updated = /^name:\s*/m.test(content)
    ? content.replace(/^(name:\s*).*$/m, `$1${name}`)
    : `---\nname: ${name}\n---\n\n${content}`;
  fs.writeFileSync(filePath, updated, "utf8");
  fs.renameSync(skillDir, nextDir);
  return { filePath: path.join(nextDir, fileName), name };
}

/** Remove a skill directory (SKILL.md parent). Allowed under agent/project skills roots. */
export async function uninstallSkill(filePath: string, cwd?: string): Promise<void> {
  if (!fs.existsSync(filePath)) throw new Error("Skill not found");
  const skillDir = path.resolve(path.dirname(filePath));
  const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
  const roots = skillActionRoots(path.resolve(getAgentDir(), "skills"), cwd);
  if (!roots.some((base) => isPathInsideRoot(base, skillDir))) {
    throw new Error(
      "Can only uninstall skills under ~/.pi/agent/skills, ~/.agents/skills or project .pi/skills (remove package skills from Extensions)",
    );
  }
  if (roots.includes(skillDir)) {
    throw new Error("Refusing to delete the skills root directory");
  }
  fs.rmSync(skillDir, { recursive: true, force: false });
}

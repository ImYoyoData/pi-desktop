import fs from "node:fs";
import path from "node:path";
import {
  DefaultResourceLoader,
  getAgentDir,
  parseFrontmatter,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
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

export function setSkillDisabled(filePath: string, disableModelInvocation: boolean): void {
  if (!fs.existsSync(filePath)) {
    throw new Error("skill file not found");
  }
  const content = fs.readFileSync(filePath, "utf8");
  const key = "disable-model-invocation";
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

/** Remove a skill directory (SKILL.md parent). Allowed under agent/project skills roots. */
export function uninstallSkill(filePath: string, cwd?: string): void {
  if (!fs.existsSync(filePath)) throw new Error("Skill not found");
  const skillDir = path.resolve(path.dirname(filePath));
  const agentSkills = path.resolve(getAgentDir(), "skills");
  const projectSkills = cwd ? path.resolve(cwd, ".pi", "skills") : null;
  const allowed =
    isPathInsideRoot(agentSkills, skillDir) ||
    (projectSkills !== null && isPathInsideRoot(projectSkills, skillDir));
  if (!allowed) {
    throw new Error(
      "Can only uninstall skills under ~/.pi/agent/skills or project .pi/skills (remove package skills from Extensions)",
    );
  }
  if (skillDir === agentSkills || (projectSkills && skillDir === projectSkills)) {
    throw new Error("Refusing to delete the skills root directory");
  }
  fs.rmSync(skillDir, { recursive: true, force: false });
}

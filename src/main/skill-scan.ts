import fs from "node:fs";
import path from "node:path";
import { homeDir } from "./agent-dir";

export type LocalSkillScope = "user" | "project";

export type LocalSkillFile = {
  filePath: string;
  scope: LocalSkillScope;
};

const SKILL_FILE_NAME = "SKILL.md";

type SkillMode = "pi" | "agents";

/** pi 的用户级技能目录（~/.pi/agent/skills、~/.agents/skills）与工作区技能目录。 */
function skillRoots(
  root: string,
  dir: string,
): Array<{ base: string; scope: LocalSkillScope; mode: SkillMode }> {
  return [
    { base: path.join(dir, "skills"), scope: "user", mode: "pi" },
    { base: path.join(homeDir(), ".agents", "skills"), scope: "user", mode: "agents" },
    { base: path.join(root, ".pi", "skills"), scope: "project", mode: "pi" },
  ];
}

function isFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** pi 目录只认根 .md，.agents 目录只认嵌套 .md（与 pi 的技能发现规则一致）。 */
function includeMarkdownFile(mode: SkillMode, isRoot: boolean): boolean {
  return mode === "pi" ? isRoot : !isRoot;
}

/** 收集技能文件：含 SKILL.md 的目录视为技能根，命中后不再向下递归。 */
function collectSkillFiles(
  dir: string,
  mode: SkillMode,
  isRoot: boolean,
  out: string[],
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const skillFile = path.join(dir, SKILL_FILE_NAME);
  if (isFile(skillFile)) {
    out.push(skillFile);
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (isDirectory(full)) collectSkillFiles(full, mode, false, out);
    else if (includeMarkdownFile(mode, isRoot) && isFile(full) && entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
}

/** 本地技能目录中未被 pi 加载的技能文件（如缺少 description），供设置页展示与修复。 */
export function scanUnloadedSkills(root: string, dir: string, loaded: Set<string>): LocalSkillFile[] {
  const found: LocalSkillFile[] = [];
  for (const { base, scope, mode } of skillRoots(root, dir)) {
    const files: string[] = [];
    collectSkillFiles(base, mode, true, files);
    for (const filePath of files) {
      if (!loaded.has(path.resolve(filePath).toLowerCase())) found.push({ filePath, scope });
    }
  }
  return found;
}

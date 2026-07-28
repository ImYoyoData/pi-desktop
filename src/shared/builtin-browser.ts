import fs from "node:fs";
import path from "node:path";
import type { ElementCitation } from "./protocol";

/** Tool name prefix for Pi Desktop embedded-browser automation. */
export const BUILTIN_BROWSER_TOOL_PREFIX = "browser_";

export function isBuiltinBrowserToolName(name: string): boolean {
  return name.startsWith(BUILTIN_BROWSER_TOOL_PREFIX);
}

/**
 * Whether this user turn should unlock built-in browser_* tools.
 * Normal web fetch / research should stay on MCP + extension tools.
 */
export function shouldEnableBuiltinBrowserTools(
  message: string,
  citations?: ElementCitation[] | null,
): boolean {
  if (citations && citations.length > 0) return true;

  const text = message.trim();
  if (!text) return false;

  // Skill expanded into the prompt, or selection context block.
  if (
    /Context from browser selection:/i.test(text) ||
    /skill[:\s]+(?:pi-desktop-)?builtin-browser\b/i.test(text) ||
    /# Built-in browser \(Pi Desktop\)/i.test(text) ||
    /Operate Pi Desktop's embedded right-pane browser/i.test(text)
  ) {
    return true;
  }

  // Explicit built-in / embedded browser.
  if (/内置浏览器|embedded\s+browser|built-?in\s+browser/i.test(text)) {
    return true;
  }

  // User mentioned browser / 浏览器 (automation intent in Desktop).
  if (/浏览器/.test(text) || /\bbrowsers?\b/i.test(text)) {
    return true;
  }

  return false;
}

/** Resolve bundled internal skill directory (dev + packaged). */
export function resolveBuiltinBrowserSkillDir(
  workerDirname: string,
  resourcesPath?: string,
): string | null {
  const candidates = [
    process.env.PI_DESKTOP_BUILTIN_BROWSER_SKILL,
    resourcesPath
      ? path.join(resourcesPath, "resources", "skills", "builtin-browser")
      : null,
    resourcesPath ? path.join(resourcesPath, "skills", "builtin-browser") : null,
    path.join(workerDirname, "../../resources/skills/builtin-browser"),
    path.join(workerDirname, "../../../resources/skills/builtin-browser"),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const skillMd = path.join(candidate, "SKILL.md");
    if (fs.existsSync(skillMd)) return path.resolve(candidate);
  }
  return null;
}

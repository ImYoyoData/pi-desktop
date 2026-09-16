import { ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import { createSkillFromDraft, listSkills, renameSkill, saveSkillContent, setSkillDisabled, uninstallSkill } from "./skills-host";
import { frontmatterText } from "./frontmatter";
import { validateSkillMeta } from "./skill-validate";
import type { SkillSaveResult } from "../shared/customizations";
import {
  listPlugins,
  checkPluginUpdates,
  removePlugin,
  setPluginEnabled,
  updatePlugin,
  type PluginScope,
} from "./plugins-host";
import { getWorkspace, listRecentDesktop } from "./workspace-ipc";

export function registerSkillsIpc(broker?: {
  restartWorkersForCwd: (cwd: string) => Promise<void>;
  notifyWorkersReloadResources?: (cwd: string) => Promise<void>;
}): void {
  ipcMain.handle(IpcChannels.skills.list, async (_event, cwd?: string) => {
    const root = cwd || getWorkspace();
    if (!root) return { skills: [], diagnostics: ["open a workspace first"] };
    return listSkills(root);
  });

  ipcMain.handle(
    IpcChannels.skills.setDisabled,
    async (_event, filePath: string, disableModelInvocation: boolean, cwd?: string) => {
      await setSkillDisabled(filePath, disableModelInvocation);
      const root = cwd || getWorkspace() || undefined;
      if (root) await broker?.notifyWorkersReloadResources?.(root);
    },
  );

  ipcMain.handle(IpcChannels.skills.uninstall, async (_event, filePath: string, cwd?: string) => {
    const root = cwd || getWorkspace() || undefined;
    await uninstallSkill(filePath, root, listRecentDesktop());
    if (root) await broker?.notifyWorkersReloadResources?.(root);
  });

  ipcMain.handle(
    IpcChannels.skills.createFromDraft,
    async (_event, content: string, scope: "user" | "project", cwd?: string): Promise<SkillSaveResult> => {
      const workspacePath = cwd?.trim() || getWorkspace() || undefined;
      if (scope === "project" && !workspacePath) throw new Error("workspace required");
      const { parseFrontmatter } = await import("@earendil-works/pi-coding-agent");
      const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
      const name = frontmatterText(frontmatter.name);
      const description = frontmatterText(frontmatter.description);
      const issues = validateSkillMeta(name, description);
      if (issues.length > 0) return { ok: false, issues };
      const result = createSkillFromDraft(content, name, description, scope, workspacePath);
      if (workspacePath) await broker?.notifyWorkersReloadResources?.(workspacePath);
      return { ok: true, filePath: result.filePath, name };
    },
  );

  ipcMain.handle(
    IpcChannels.skills.save,
    async (
      _event,
      filePath: string,
      content: string,
      renameName?: string,
      cwd?: string,
    ): Promise<SkillSaveResult> => {
      const { parseFrontmatter } = await import("@earendil-works/pi-coding-agent");
      const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
      const name = frontmatterText(frontmatter.name);
      const description = frontmatterText(frontmatter.description);
      const issues = validateSkillMeta(name, description);
      if (issues.length > 0) return { ok: false, issues };
      const root = cwd || getWorkspace() || undefined;
      const result = saveSkillContent(filePath, content, name, renameName, root, listRecentDesktop());
      if (root) await broker?.notifyWorkersReloadResources?.(root);
      return { ok: true, filePath: result.filePath, name: result.name };
    },
  );

  ipcMain.handle(
    IpcChannels.skills.rename,
    async (_event, filePath: string, name: string, cwd?: string) => {
      const root = cwd || getWorkspace() || undefined;
      const result = renameSkill(filePath, name, root, listRecentDesktop());
      if (root) await broker?.notifyWorkersReloadResources?.(root);
      return result;
    },
  );

  ipcMain.handle(IpcChannels.plugins.list, async (_event, cwd?: string) => {
    const root = cwd || getWorkspace();
    if (!root) return { packages: [] };
    return listPlugins(root);
  });

  ipcMain.handle(
    IpcChannels.plugins.setEnabled,
    async (_event, source: string, scope: PluginScope, enabled: boolean, cwd?: string) => {
      const root = cwd || getWorkspace();
      if (!root) throw new Error("workspace required");
      await setPluginEnabled(root, source, scope, enabled);
      await broker?.restartWorkersForCwd(root);
      return listPlugins(root);
    },
  );

  ipcMain.handle(
    IpcChannels.plugins.remove,
    async (_event, source: string, scope: PluginScope, cwd?: string) => {
      const root = cwd || getWorkspace();
      if (!root) throw new Error("workspace required");
      await removePlugin(root, source, scope);
      await broker?.restartWorkersForCwd(root);
      return listPlugins(root);
    },
  );

  ipcMain.handle(IpcChannels.plugins.checkUpdates, async (_event, cwd?: string) => {
    const root = cwd || getWorkspace();
    if (!root) return [];
    return checkPluginUpdates(root);
  });

  ipcMain.handle(
    IpcChannels.plugins.update,
    async (_event, source: string, scope: PluginScope, cwd?: string) => {
      const root = cwd || getWorkspace();
      if (!root) throw new Error("workspace required");
      await updatePlugin(root, source, scope);
      await broker?.restartWorkersForCwd(root);
      return listPlugins(root);
    },
  );
}

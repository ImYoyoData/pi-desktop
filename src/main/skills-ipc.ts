import { ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import { listSkills, setSkillDisabled, uninstallSkill } from "./skills-host";
import { listPlugins, removePlugin, setPluginEnabled, type PluginScope } from "./plugins-host";
import { getWorkspace } from "./workspace-ipc";

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
    await uninstallSkill(filePath, root);
    if (root) await broker?.notifyWorkersReloadResources?.(root);
  });

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
}
